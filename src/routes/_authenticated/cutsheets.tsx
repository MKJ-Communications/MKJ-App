import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchCurrentSharepointFiles, formatBytes, syncCutsheets, type CutsheetSyncRun } from "@/lib/cutsheets";

// Admin-only view of the vendor cutsheets indexed from SharePoint. Stage 1:
// sync and see what's there. Creating and linking products from these files
// comes next (see CLAUDE.md → Cutsheets).

export const Route = createFileRoute("/_authenticated/cutsheets")({
  head: () => ({ meta: [{ title: "Cutsheets — MKJ Ops" }] }),
  // Redirect from the component, not beforeLoad — see _authenticated/route.tsx.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return { isAdmin: false };
    const { data: adminRow } = await supabase
      .from("user_roles").select("role").eq("user_id", data.user.id).eq("role", "admin").maybeSingle();
    return { isAdmin: !!adminRow };
  },
  component: CutsheetsRoute,
});

function CutsheetsRoute() {
  const { isAdmin } = Route.useRouteContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAdmin) navigate({ to: "/dashboard", replace: true });
  }, [isAdmin, navigate]);

  return isAdmin ? <CutsheetsPage /> : null;
}

const SHOW_LIMIT = 200;

function CutsheetsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const lastRun = useQuery({
    queryKey: ["cutsheet-sync-runs", "latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cutsheet_sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const files = useQuery({ queryKey: ["sharepoint-files"], queryFn: fetchCurrentSharepointFiles });

  const syncMut = useMutation({
    mutationFn: syncCutsheets,
    onSuccess: (r) => {
      toast.success(`Synced ${r.files_seen} files: ${r.files_added} new, ${r.files_changed} changed, ${r.files_removed} removed.`);
    },
    onError: (e: Error) => toast.error(e.message),
    // The run is logged either way, so refresh both on failure too.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["cutsheet-sync-runs"] });
      qc.invalidateQueries({ queryKey: ["sharepoint-files"] });
    },
  });

  const term = q.trim().toLowerCase();
  const matches = useMemo(() => {
    const all = files.data ?? [];
    if (!term) return all;
    return all.filter((f) => `${f.folder_path} ${f.name}`.toLowerCase().includes(term));
  }, [files.data, term]);

  // "pdf 812 · dwg 40 · …" — shows at a glance what else lives in the folder.
  const byType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of files.data ?? []) counts.set(f.extension ?? "no type", (counts.get(f.extension ?? "no type") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [files.data]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Cutsheets"
        description="Vendor cutsheets in SharePoint: Wiki › Vendor Docs, Cuts & CAD Blocks › Vendor Product Cutsheets & Docs."
        actions={
          <Button onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
            <RefreshCw className={`mr-1 h-4 w-4 ${syncMut.isPending ? "animate-spin" : ""}`} />
            {syncMut.isPending ? "Syncing…" : "Sync now"}
          </Button>
        }
      />

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Last sync</CardTitle>
        </CardHeader>
        <CardContent>
          {lastRun.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : lastRun.data ? (
            <LastSync run={lastRun.data} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Never synced. Once the Microsoft setup in <span className="font-mono">supabase/functions/sharepoint-cutsheets/README.md</span> is
              done, press <strong>Sync now</strong>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Files</CardTitle>
          <CardDescription>
            {files.data
              ? `${files.data.length} files${byType.length ? ` · ${byType.map(([ext, n]) => `${ext} ${n}`).join(" · ")}` : ""}`
              : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search folder or file name…" className="pl-9" />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Folder</TableHead><TableHead>File</TableHead><TableHead>Type</TableHead>
                <TableHead className="text-right">Size</TableHead><TableHead>Modified</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {matches.length > 0 ? matches.slice(0, SHOW_LIMIT).map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-sm text-muted-foreground">{f.folder_path || "—"}</TableCell>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>{f.extension ? <Badge variant="secondary">{f.extension}</Badge> : "—"}</TableCell>
                    <TableCell className="text-right text-sm">{formatBytes(f.size_bytes)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {f.sp_modified_at ? new Date(f.sp_modified_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Opens in SharePoint, so it needs the browser signed in to Microsoft 365. */}
                      <Button asChild size="icon" variant="ghost" aria-label={`Open ${f.name} in SharePoint`}>
                        <a href={f.web_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      {files.isLoading ? "Loading…" : term ? "No matches." : "No files yet — run a sync."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {matches.length > SHOW_LIMIT ? (
            <p className="text-xs text-muted-foreground">Showing the first {SHOW_LIMIT} of {matches.length}. Search to narrow it down.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function LastSync({ run }: { run: CutsheetSyncRun }) {
  const started = new Date(run.started_at);
  const seconds = run.finished_at ? Math.round((new Date(run.finished_at).getTime() - started.getTime()) / 1000) : null;
  const status =
    run.status === "succeeded" ? <Badge>Succeeded</Badge>
    : run.status === "failed" ? <Badge variant="destructive">Failed</Badge>
    : <Badge variant="secondary">Running…</Badge>;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {status}
        <span className="text-muted-foreground">
          {run.trigger === "scheduled" ? "Nightly sync" : "Manual sync"} · {started.toLocaleString()}
          {seconds != null ? ` · ${seconds}s` : ""}
        </span>
      </div>
      {run.status === "succeeded" ? (
        <p>
          {run.folders_scanned} folders · {run.files_seen} files · {run.files_added} new · {run.files_changed} changed ·{" "}
          {run.files_removed} removed
        </p>
      ) : null}
      {run.error ? <p className="text-destructive">{run.error}</p> : null}
    </div>
  );
}
