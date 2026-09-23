import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ListTree, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BuildStatusBadge } from "@/components/build-request-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoles } from "@/hooks/use-session";
import { canWrite } from "@/lib/roles";
import { BUILD_REQUEST_LIST_LIMIT, OPEN_BUILD_STATUSES, useBuildRequests, type BuildRequest } from "@/lib/build-requests";

const LIST_TABS = ["all", "open", "waiting", "drafts"] as const;
type ListTab = (typeof LIST_TABS)[number];

const TAB_LABELS: Record<ListTab, string> = { all: "All", open: "Open", waiting: "Waiting on parts", drafts: "Drafts & rejected" };

function inTab(r: BuildRequest, tab: ListTab) {
  if (tab === "open") return OPEN_BUILD_STATUSES.includes(r.status);
  if (tab === "waiting") return r.status === "partially_built";
  if (tab === "drafts") return r.status === "draft" || r.status === "rejected";
  return true;
}

export const Route = createFileRoute("/_authenticated/manufacturing/")({
  head: () => ({ meta: [{ title: "Manufacturing — MKJ Ops" }] }),
  // ?tab=open is where the dashboard's Open Builds card points.
  validateSearch: (s: Record<string, unknown>): { tab?: ListTab } => ({
    tab: LIST_TABS.includes(s.tab as ListTab) ? (s.tab as ListTab) : undefined,
  }),
  component: BuildRequestsPage,
});

function BuildRequestsPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const tab: ListTab = Route.useSearch().tab ?? "all";
  const roles = useRoles().data ?? [];
  // Managers (own projects), warehouse managers and admins; the RPC checks the project.
  const canCreate = canWrite(roles);
  const requests = useBuildRequests();
  const [q, setQ] = useState("");

  const all = useMemo(() => requests.data?.rows ?? [], [requests.data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((r) => inTab(r, tab))
      .filter((r) =>
        !needle
          ? true
          : [r.request_number, r.project_number, r.project_name, r.template?.system_code, r.template?.name, r.requester_name, r.notes]
              .some((v) => (v ?? "").toLowerCase().includes(needle)),
      );
  }, [all, tab, q]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Manufacturing"
        description="Requests for the shop to build standard systems from a project's stock. Submitted requests hold the parts they need."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/manufacturing/systems"><ListTree className="mr-2 h-4 w-4" />Systems</Link>
            </Button>
            {canCreate ? (
              <Button asChild>
                <Link to="/manufacturing/new"><Plus className="mr-2 h-4 w-4" />New build request</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={tab} onValueChange={(v) => navigate({ search: (prev) => ({ ...prev, tab: v === "all" ? undefined : (v as ListTab) }) })}>
          <TabsList>
            {LIST_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
                {t !== "all" ? <span className="ml-1.5 text-xs text-muted-foreground">{all.filter((r) => inTab(r, t)).length}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search request, project, system…" className="pl-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>System</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Parts held</TableHead>
                <TableHead>Requested</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length > 0 ? (
                rows.map((r) => {
                  const open = OPEN_BUILD_STATUSES.includes(r.status);
                  // Before the start: parts fully held. After: parts fully installed.
                  const building = r.status === "in_progress" || r.status === "partially_built";
                  const fullyHeld = r.lines.filter((l) => (building ? l.qty_consumed : l.qty_held) >= l.qty_required).length;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link to="/manufacturing/$id" params={{ id: r.id }} className="font-mono text-primary hover:underline">
                          {r.request_number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono">{r.project_number}</span>
                        {r.project_name ? <div className="text-xs text-muted-foreground">{r.project_name}</div> : null}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono">{r.template?.system_code}</span>
                        {r.template?.name ? <div className="text-xs text-muted-foreground">{r.template.name}</div> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                      <TableCell><BuildStatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">
                        {open ? `${fullyHeld} / ${r.lines.length}${building ? " installed" : ""}` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.requester_name ?? "—"}
                        <div>{new Date(r.created_at).toLocaleDateString()}</div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    {q.trim() ? "No matches." : all.length === 0 ? "No build requests yet." : "Nothing here."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {requests.data?.truncated ? (
        <p className="mt-2 text-xs text-muted-foreground">Showing the newest {BUILD_REQUEST_LIST_LIMIT} requests.</p>
      ) : null}
    </div>
  );
}
