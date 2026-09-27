import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

// Vendor cutsheets indexed from SharePoint by the sharepoint-cutsheets edge
// function. See supabase/functions/sharepoint-cutsheets/README.md.

export type SharepointFile = Tables<"sharepoint_files">;
export type CutsheetSyncRun = Tables<"cutsheet_sync_runs">;

export type SyncResult = {
  run_id: string;
  folders_scanned: number;
  files_seen: number;
  files_added: number;
  files_changed: number;
  files_removed: number;
};

// The function answers errors with { error }; invoke() only surfaces a
// generic "non-2xx status" message, so read the body for the real one.
async function functionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null);
    if (body?.error) return String(body.error);
  }
  return error instanceof Error ? error.message : String(error);
}

/** Lists the whole SharePoint cutsheets folder now. Admins only. */
export async function syncCutsheets(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke<SyncResult>("sharepoint-cutsheets", {
    body: { action: "sync" },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data) throw new Error("The sync returned nothing.");
  return data;
}

/** Every file currently in the folder (PostgREST caps a request at 1,000 rows). */
export async function fetchCurrentSharepointFiles(): Promise<SharepointFile[]> {
  const pageSize = 1000;
  const all: SharepointFile[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("sharepoint_files")
      .select("*")
      .is("removed_at", null)
      .order("folder_path")
      .order("name")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < pageSize) return all;
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
