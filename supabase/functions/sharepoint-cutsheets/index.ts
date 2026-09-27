// Vendor cutsheets from SharePoint. See README.md for the one-time Microsoft
// setup and supabase/migrations/20260926232554_sharepoint_cutsheets.sql for
// the tables.
//
//   { action: "sync" }  Admins only. Lists every file under the cutsheets
//                       folder (all subfolders) and hands the complete list
//                       to record_sharepoint_sync, which works out what was
//                       added, changed or removed. Only one sync runs at a
//                       time; each is logged in cutsheet_sync_runs, failures
//                       included.
//
// Microsoft Graph is called as the "MKJ App – SharePoint reader" app (client
// credentials), which can read the main site and nothing else. Users never
// need SharePoint access for this.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Where the cutsheets live:
// https://mkjcommunications.sharepoint.com/Wiki/Vendor Docs, Cuts & CAD Blocks/Vendor Product Cutsheets & Docs
const SHAREPOINT_HOST = "mkjcommunications.sharepoint.com";
// The library's URL name (the path segment after the host), not its title.
const SHAREPOINT_LIBRARY = "Wiki";
const SHAREPOINT_FOLDER = "Vendor Docs, Cuts & CAD Blocks/Vendor Product Cutsheets & Docs";

const GRAPH = "https://graph.microsoft.com/v1.0";
// Edge functions are cut off at 150 s; stop listing well before that so the
// failure is recorded with a clear message instead of the run timing out.
const LISTING_BUDGET_MS = 120_000;
const MAX_PARALLEL_FOLDERS = 6;
const MAX_FILES = 25_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Microsoft Graph
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new HttpError(500, `${name} is not set. Add it under Supabase → Edge Functions → Secrets (see the sharepoint-cutsheets README).`);
  }
  return value;
}

async function getGraphToken(): Promise<string> {
  const tenantId = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== "string") {
    // error_description starts with the AADSTS code, which is what the README's
    // troubleshooting table keys on.
    const detail = body.error_description ?? body.error ?? `HTTP ${res.status}`;
    throw new HttpError(502, `Microsoft sign-in failed: ${String(detail).split("\r\n")[0]}`);
  }
  return body.access_token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET a Graph URL (absolute, e.g. an @odata.nextLink, or relative to /v1.0).
// Retries throttling and transient errors, honouring Retry-After.
async function graphGet<T>(token: string, pathOrUrl: string, what: string): Promise<T> {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return (await res.json()) as T;

    const retryable = res.status === 429 || res.status === 503 || res.status === 504;
    if (retryable && attempt < 5) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : attempt * 1000);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    const code = body?.error?.code ? ` ${body.error.code}` : "";
    const message = body?.error?.message ? `: ${body.error.message}` : "";
    throw new HttpError(502, `Microsoft Graph returned ${res.status}${code} while ${what}${message}`);
  }
}

interface GraphDrive { id: string; name: string; webUrl: string }
interface GraphItem {
  id: string;
  name: string;
  size?: number;
  webUrl: string;
  lastModifiedDateTime?: string;
  eTag?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
}
interface GraphPage<T> { value: T[]; "@odata.nextLink"?: string }

// Each segment encoded on its own: the folder names contain "," and "&".
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function findCutsheetsFolder(token: string): Promise<{ driveId: string; folderId: string }> {
  const site = await graphGet<{ id: string }>(token, `/sites/${SHAREPOINT_HOST}`, "opening the SharePoint site");

  const drives = await graphGet<GraphPage<GraphDrive>>(token, `/sites/${site.id}/drives?$select=id,name,webUrl`, "listing the site's libraries");
  const libraryUrlName = (d: GraphDrive) =>
    decodeURIComponent(new URL(d.webUrl).pathname).replace(/\/+$/, "").split("/").pop() ?? "";
  const drive = drives.value.find((d) => libraryUrlName(d).toLowerCase() === SHAREPOINT_LIBRARY.toLowerCase());
  if (!drive) {
    const found = drives.value.map(libraryUrlName).join(", ") || "none";
    throw new HttpError(502, `The "${SHAREPOINT_LIBRARY}" library wasn't found on ${SHAREPOINT_HOST} (libraries the app can see: ${found}).`);
  }

  const folder = await graphGet<GraphItem>(
    token,
    `/drives/${drive.id}/root:/${encodePath(SHAREPOINT_FOLDER)}?$select=id,name,folder`,
    `opening "${SHAREPOINT_FOLDER}"`,
  );
  if (!folder.folder) throw new HttpError(502, `"${SHAREPOINT_FOLDER}" is not a folder.`);
  return { driveId: drive.id, folderId: folder.id };
}

interface FileRow {
  item_id: string;
  name: string;
  folder_path: string;
  extension: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  web_url: string;
  sp_modified_at: string | null;
  etag: string | null;
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
}

// Breadth-first over the folder tree, a few folders at a time.
async function listAllFiles(token: string, driveId: string, rootId: string): Promise<{ files: FileRow[]; foldersScanned: number }> {
  const started = Date.now();
  const queue: { id: string; path: string }[] = [{ id: rootId, path: "" }];
  const files: FileRow[] = [];
  let foldersScanned = 0;
  let failure: unknown = null;

  async function scan(folder: { id: string; path: string }) {
    let next: string | undefined =
      `/drives/${driveId}/items/${folder.id}/children?$top=999&$select=id,name,size,webUrl,lastModifiedDateTime,eTag,file,folder`;
    while (next) {
      if (Date.now() - started > LISTING_BUDGET_MS) {
        throw new HttpError(504, `Listing SharePoint took longer than ${LISTING_BUDGET_MS / 1000} s (${foldersScanned} folders, ${files.length} files so far). Nothing was changed.`);
      }
      const page: GraphPage<GraphItem> = await graphGet(token, next, `listing "${folder.path || "the cutsheets folder"}"`);
      for (const item of page.value) {
        if (item.folder) {
          queue.push({ id: item.id, path: folder.path ? `${folder.path}/${item.name}` : item.name });
        } else if (item.file) {
          files.push({
            item_id: item.id,
            name: item.name,
            folder_path: folder.path,
            extension: extensionOf(item.name),
            mime_type: item.file.mimeType ?? null,
            size_bytes: item.size ?? null,
            web_url: item.webUrl,
            sp_modified_at: item.lastModifiedDateTime ?? null,
            etag: item.eTag ?? null,
          });
        }
      }
      if (files.length > MAX_FILES) {
        throw new HttpError(502, `More than ${MAX_FILES} files under the cutsheets folder: is SHAREPOINT_FOLDER pointing at the right place? Nothing was changed.`);
      }
      next = page["@odata.nextLink"];
    }
    foldersScanned++;
  }

  // Workers pull from the shared queue until it's empty and nobody is still
  // scanning (a folder being scanned can add more to the queue).
  let active = 0;
  async function worker() {
    while (!failure) {
      const folder = queue.shift();
      if (!folder) {
        if (active === 0) return;
        await sleep(25);
        continue;
      }
      active++;
      try {
        await scan(folder);
      } catch (e) {
        failure = failure ?? e;
      } finally {
        active--;
      }
    }
  }
  await Promise.all(Array.from({ length: MAX_PARALLEL_FOLDERS }, worker));
  if (failure) throw failure;

  return { files, foldersScanned };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function sync(serviceClient: SupabaseClient, userId: string): Promise<Response> {
  const { data: runId, error: startErr } = await serviceClient.rpc("start_cutsheet_sync", {
    _trigger: "manual",
    _triggered_by: userId,
  });
  if (startErr) return json({ error: startErr.message }, startErr.message.includes("already running") ? 409 : 500);

  try {
    const token = await getGraphToken();
    const { driveId, folderId } = await findCutsheetsFolder(token);
    const { files, foldersScanned } = await listAllFiles(token, driveId, folderId);

    const { data: counts, error: recordErr } = await serviceClient.rpc("record_sharepoint_sync", {
      _run_id: runId,
      _drive_id: driveId,
      _folders_scanned: foldersScanned,
      _files: files,
    });
    if (recordErr) throw new HttpError(500, recordErr.message);
    return json({ run_id: runId, ...counts }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await serviceClient.rpc("fail_cutsheet_sync", { _run_id: runId, _error: message });
    return json({ run_id: runId, error: message }, e instanceof HttpError ? e.status : 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);

    const body = await req.json().catch(() => ({}));
    switch (body?.action) {
      case "sync": {
        const { data: isAdmin, error } = await callerClient.rpc("is_admin", { _user_id: user.id });
        if (error) throw error;
        if (!isAdmin) return json({ error: "Only admins can sync cutsheets." }, 403);
        return await sync(serviceClient, user.id);
      }
      default:
        return json({ error: 'Unknown action. Expected "sync".' }, 400);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, e instanceof HttpError ? e.status : 500);
  }
});
