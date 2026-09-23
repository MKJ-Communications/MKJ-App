import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Ban, CheckCheck, Hammer, PackageCheck, PackagePlus, Pencil, Send, Undo2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { BuildConsumeDialog } from "@/components/build-consume-dialog";
import { BuildStatusBadge, LineOriginBadge, LineStockState } from "@/components/build-request-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRoles, useSession } from "@/hooks/use-session";
import { useMyManagedProjectIds } from "@/lib/po-requests";
import {
  buildPermissions,
  computeCoverage,
  useBuildRequest,
  useProjectAvailable,
  type BuildEvent,
  type BuildLine,
} from "@/lib/build-requests";
import { formatQty } from "@/lib/system-templates";

export const Route = createFileRoute("/_authenticated/manufacturing/$id")({
  head: () => ({ meta: [{ title: "Build request — MKJ Ops" }] }),
  component: BuildRequestPage,
});

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  submitted: "Submitted to the shop",
  pulled_back: "Pulled back to draft",
  rejected: "Rejected",
  parts_held: "Parts arrived and were held",
  started: "Build started",
  parts_installed: "Arrived parts installed",
  partially_built: "Marked partially built",
  completed: "Completed",
  cancelled: "Cancelled",
};

type UsedPart = { part_number: string; qty: number };
const partsList = (parts: unknown) =>
  Array.isArray(parts) ? (parts as UsedPart[]).map((u) => `${formatQty(Number(u.qty))} × ${u.part_number}`).join(", ") : "";

function eventLabel(e: BuildEvent): string {
  if (e.kind === "edited" && e.payload?.from_status === "submitted") return "Parts list changed by the warehouse";
  return EVENT_LABELS[e.kind] ?? e.kind;
}

function eventDetail(e: BuildEvent): string {
  const p = e.payload ?? {};
  switch (e.kind) {
    case "submitted":
      return `${p.covered} of ${p.total} parts fully held`;
    case "parts_held": {
      const still = Number(p.still_pending ?? 0);
      return `${p.qty} × ${p.part_number}${still > 0 ? ` · ${still} still pending` : ""}`;
    }
    case "started":
    case "parts_installed": {
      const used = partsList(p.used);
      return [used ? `Used ${used}` : "", p.pending ? `Still pending: ${p.pending}` : ""].filter(Boolean).join(" · ");
    }
    case "partially_built":
      return p.pending ? `Waiting on ${p.pending}` : "";
    case "completed":
      return Array.isArray(p.unit_ids) ? `Units: ${(p.unit_ids as string[]).join(", ")}` : "";
    case "cancelled": {
      const back = partsList(p.returned);
      return [e.note ?? "", back ? `Returned to stock: ${back}` : ""].filter(Boolean).join(" · ");
    }
    case "created":
    case "edited": {
      const removed = Array.isArray(p.removed) && p.removed.length > 0 ? `Left out from the system's list: ${(p.removed as string[]).join(", ")}` : "";
      const held = p.from_status === "submitted" && p.total != null ? `${p.covered} of ${p.total} parts held` : "";
      return [removed, held].filter(Boolean).join(" · ");
    }
    default:
      return e.note ?? "";
  }
}

/** Where a line stands once the build has started. */
function BuildLineState({ line }: { line: BuildLine }) {
  if (line.qty_consumed >= line.qty_required) {
    return <span className="rounded bg-status-received px-1.5 py-0.5 text-xs font-medium text-status-received-foreground">Installed</span>;
  }
  if (line.qty_held > line.qty_consumed) {
    return (
      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
        {formatQty(line.qty_held - line.qty_consumed)} arrived — install
      </span>
    );
  }
  return (
    <span className="rounded bg-status-partial px-1.5 py-0.5 text-xs font-medium text-status-partial-foreground">
      {formatQty(line.qty_required - line.qty_held)} pending
    </span>
  );
}

type DialogKind = "reject" | "pull-back" | "partial" | "complete" | "cancel" | null;

function BuildRequestPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { userId } = useSession();
  const roles = useRoles().data ?? [];
  const managed = useMyManagedProjectIds().data ?? [];
  const query = useBuildRequest(id);
  const r = query.data?.request ?? null;
  const events = query.data?.events ?? [];
  const editable = !!r && (r.status === "draft" || r.status === "rejected");
  const available = useProjectAvailable(editable ? r!.project_id : null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [consume, setConsume] = useState<"start" | "install" | null>(null);
  const [note, setNote] = useState("");

  function refresh() {
    qc.invalidateQueries({ queryKey: ["build-request", id] });
    qc.invalidateQueries({ queryKey: ["build-requests"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["inventory-serials"] });
    qc.invalidateQueries({ queryKey: ["serials-available"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  }
  function closeDialog() {
    setDialog(null);
    setNote("");
  }

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("submit_build_request", { _request_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${r!.request_number} submitted — the available parts are now held`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const act = useMutation({
    mutationFn: async (kind: Exclude<DialogKind, null>) => {
      if ((kind === "reject" || kind === "cancel") && !note.trim()) {
        throw new Error(kind === "reject" ? "Give a reason for rejecting" : "Give a reason for cancelling");
      }
      const { error } =
        kind === "reject" ? await supabase.rpc("reject_build_request", { _request_id: id, _note: note })
        : kind === "pull-back" ? await supabase.rpc("pull_back_build_request", { _request_id: id })
        : kind === "partial" ? await supabase.rpc("mark_build_partially_built", { _request_id: id })
        : kind === "complete" ? await supabase.rpc("complete_build_request", { _request_id: id })
        : await supabase.rpc("cancel_build_request", { _request_id: id, _reason: note });
      if (error) throw error;
      return kind;
    },
    onSuccess: (kind) => {
      const n = r!.request_number;
      const msg: Record<Exclude<DialogKind, null>, string> = {
        reject: `${n} rejected. The requester was notified.`,
        "pull-back": `${n} is a draft again. Its held parts were released.`,
        partial: `${n} marked partially built. The units go into stock once the pending parts are installed.`,
        complete: `${n} is complete — the units are now in stock.`,
        cancel: `${n} cancelled. Its parts went back to stock.`,
      };
      toast.success(msg[kind]);
      closeDialog();
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!r) return <p className="text-sm text-muted-foreground">Build request not found.</p>;

  const perms = buildPermissions(r, roles, managed);
  const started = r.status === "in_progress" || r.status === "partially_built" || r.status === "completed";
  const coverageNow = editable
    ? computeCoverage(
        r.lines.map((l) => ({ product_id: l.product_id, part_number: l.product?.part_number ?? "?", is_key_part: l.is_key_part, required: l.qty_required })),
        available.data ?? new Map(),
      )
    : null;
  const fullyHeld = r.lines.filter((l) => l.qty_held >= l.qty_required).length;
  const installed = r.lines.filter((l) => l.qty_consumed >= l.qty_required).length;
  const who = (uid: string | null, name: string | null) => (uid && uid === userId ? "You" : name ?? "Unknown user");

  const dialogCopy: Record<Exclude<DialogKind, null>, { title: string; body: string; action: string; destructive?: boolean; needsNote?: boolean }> = {
    reject: {
      title: `Reject ${r.request_number}`,
      body: "Its held parts are released and the requester is notified. They can edit the request and submit it again.",
      action: "Reject request",
      destructive: true,
      needsNote: true,
    },
    "pull-back": {
      title: `Pull back ${r.request_number}`,
      body: "It goes back to draft and its held parts are released, so other builds or tickets can use them. You can submit it again later if the stock is still there.",
      action: "Pull back to draft",
    },
    partial: {
      title: `Mark ${r.request_number} partially built`,
      body: "Use this when the units are assembled but parts are still pending. They stay out of stock until the pending parts are installed and the build is completed, and it can no longer be cancelled.",
      action: "Mark partially built",
    },
    complete: {
      title: `Complete ${r.request_number}`,
      body: `Adds ${r.qty} × ${r.template?.system_code ?? "system"} to ${r.project_number}'s stock, each with its own unit ID (${r.project_number}-${r.template?.system_code ?? "CODE"}-NNN). They can then go out on a shipping ticket.`,
      action: "Complete build",
    },
    cancel: {
      title: `Cancel ${r.request_number}`,
      body: "Every part used so far goes back to the project's stock, along with its serial numbers. The request is kept, with your reason, so it can be checked later.",
      action: "Cancel build",
      destructive: true,
      needsNote: true,
    },
  };
  const current = dialog ? dialogCopy[dialog] : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={r.request_number}
        description={`${r.qty} × ${r.template?.system_code ?? "system"}${r.template?.name ? ` — ${r.template.name}` : ""} · ${r.project_number}${r.project_name ? ` — ${r.project_name}` : ""}`}
        backTo="/manufacturing"
        actions={
          <>
            <BuildStatusBadge status={r.status} className="mr-1" />
            {perms.canEdit ? (
              <Button variant="outline" asChild>
                <Link to="/manufacturing/edit/$id" params={{ id }}><Pencil className="mr-2 h-4 w-4" />{r.status === "submitted" ? "Change parts" : "Edit"}</Link>
              </Button>
            ) : null}
            {perms.canPullBack ? <Button variant="outline" onClick={() => setDialog("pull-back")}><Undo2 className="mr-2 h-4 w-4" />Pull back</Button> : null}
            {perms.canReject ? <Button variant="outline" onClick={() => setDialog("reject")}><XCircle className="mr-2 h-4 w-4" />Reject</Button> : null}
            {perms.canCancel ? <Button variant="outline" onClick={() => setDialog("cancel")}><Ban className="mr-2 h-4 w-4" />Cancel build</Button> : null}
            {perms.canMarkPartial ? <Button variant="outline" onClick={() => setDialog("partial")}><PackagePlus className="mr-2 h-4 w-4" />Mark partially built</Button> : null}
            {perms.canInstall ? <Button variant="outline" onClick={() => setConsume("install")}><PackageCheck className="mr-2 h-4 w-4" />Install arrived parts</Button> : null}
            {perms.canComplete ? (
              <Button
                onClick={() => setDialog("complete")}
                disabled={!perms.readyToComplete || perms.hasArrived}
                title={perms.hasArrived ? "Install the parts that arrived first" : !perms.readyToComplete ? "Parts are still pending" : undefined}
              >
                <CheckCheck className="mr-2 h-4 w-4" />Complete
              </Button>
            ) : null}
            {perms.canStart ? <Button onClick={() => setConsume("start")}><Hammer className="mr-2 h-4 w-4" />Start build</Button> : null}
            {perms.canSubmit ? (
              <Button onClick={() => submit.mutate()} disabled={submit.isPending || available.isLoading || !coverageNow?.passes}>
                <Send className="mr-2 h-4 w-4" />{submit.isPending ? "Submitting…" : "Submit to the shop"}
              </Button>
            ) : null}
          </>
        }
      />

      {r.status === "rejected" && r.reject_note ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Rejected by {who(r.rejected_by, r.rejecter_name)}{r.rejected_at ? ` · ${new Date(r.rejected_at).toLocaleString()}` : ""}</AlertTitle>
          <AlertDescription>{r.reject_note} {perms.canEdit ? "Edit the request and submit it again." : ""}</AlertDescription>
        </Alert>
      ) : null}
      {r.status === "cancelled" && r.cancel_reason ? (
        <Alert>
          <Ban className="h-4 w-4" />
          <AlertTitle>Cancelled by {who(r.cancelled_by, r.canceller_name)}{r.cancelled_at ? ` · ${new Date(r.cancelled_at).toLocaleString()}` : ""}</AlertTitle>
          <AlertDescription>{r.cancel_reason} The parts it had used went back to stock.</AlertDescription>
        </Alert>
      ) : null}
      {r.status === "partially_built" ? (
        <Alert>
          <PackagePlus className="h-4 w-4" />
          <AlertTitle>Built, waiting on parts</AlertTitle>
          <AlertDescription>
            The units exist but aren't in stock yet. Parts that arrive in {r.project_number} are held for this build automatically; install them, then complete it.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Requested</div>
            <div>{who(r.requested_by, r.requester_name)}</div>
            <div className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
            {r.started_at ? <div className="text-muted-foreground">Started {new Date(r.started_at).toLocaleString()}</div> : null}
            {r.completed_at ? <div className="text-muted-foreground">Completed {new Date(r.completed_at).toLocaleString()}</div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Parts</div>
            {started ? (
              <>
                <div><strong>{installed} of {r.lines.length}</strong> installed</div>
                <div className="text-muted-foreground">
                  {perms.hasArrived
                    ? "Some parts arrived and are waiting to be installed."
                    : installed < r.lines.length
                      ? "Pending parts are held automatically as they arrive."
                      : "Every part is installed."}
                </div>
              </>
            ) : r.status === "submitted" ? (
              <>
                <div><strong>{fullyHeld} of {r.lines.length}</strong> fully held</div>
                <div className="text-muted-foreground">
                  {fullyHeld < r.lines.length ? "Pending parts are held automatically as they arrive." : "Everything this build needs is held."}
                </div>
              </>
            ) : coverageNow ? (
              <>
                <div><strong>{coverageNow.covered} of {coverageNow.total}</strong> can be fully held now ({coverageNow.pct}%)</div>
                <div className={coverageNow.passes ? "text-muted-foreground" : "text-destructive"}>
                  {coverageNow.passes ? "Ready to submit." : coverageNow.reason}
                </div>
              </>
            ) : (
              <div>{r.lines.length} parts</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
            <p className="whitespace-pre-wrap">{r.notes ?? <span className="text-muted-foreground">None</span>}</p>
          </CardContent>
        </Card>
      </div>

      {r.units.length > 0 ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Finished units</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {r.units.map((u) => <span key={u.unit_id} className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs">{u.unit_id}</span>)}
            </div>
            <p className="text-xs text-muted-foreground">
              In stock at {r.project_number} as {r.template?.system_code}. Pick them by unit ID on a shipping ticket.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Parts for {r.qty} × {r.template?.system_code}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Part</TableHead>
                <TableHead className="text-right">Per unit</TableHead>
                <TableHead className="text-right">Needed</TableHead>
                <TableHead className="text-right">{editable ? "Available now" : "Held"}</TableHead>
                {started || r.status === "cancelled" ? <TableHead className="text-right">Used</TableHead> : null}
                <TableHead>Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.lines.map((l, i) => {
                const row = coverageNow?.rows[i];
                const serials = l.serials.filter((s) => r.status === "cancelled" || !s.returned_at);
                return (
                  <TableRow key={l.id}>
                    <TableCell>{l.line_no}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs">{l.product?.part_number}</span>
                        {l.is_key_part ? <Badge>Key</Badge> : null}
                        <LineOriginBadge origin={l.origin} />
                      </div>
                      <div className="text-xs text-muted-foreground">{l.product?.description}</div>
                      {serials.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {serials.map((s) => (
                            <span
                              key={s.serial}
                              className={`rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] ${s.returned_at ? "line-through opacity-60" : ""}`}
                              title={s.entered_manually ? "Typed in: not on record (received before serial tracking)" : undefined}
                            >
                              {s.serial}{s.entered_manually ? " · typed" : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.qty_per_unit)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatQty(l.qty_required)} <span className="text-xs text-muted-foreground">{l.product?.unit}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {editable ? (row ? formatQty(row.available) : "—") : formatQty(l.qty_held)}
                    </TableCell>
                    {started || r.status === "cancelled" ? <TableCell className="text-right tabular-nums">{formatQty(l.qty_consumed)}</TableCell> : null}
                    <TableCell>
                      {started ? (
                        <BuildLineState line={l} />
                      ) : editable ? (
                        <LineStockState covered={!!row?.covered} pending={formatQty(row ? row.required - row.canHold : l.qty_required)} />
                      ) : r.status === "submitted" ? (
                        <LineStockState covered={l.qty_held >= l.qty_required} pending={formatQty(l.qty_required - l.qty_held)} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent>
          {events.length > 0 ? (
            <ol className="space-y-3">
              {events.map((e) => (
                <li key={e.id} className="text-sm">
                  <div>
                    <span className="font-medium">{eventLabel(e)}</span>
                    <span className="text-muted-foreground"> · {who(e.actor, e.actor_name)} · {new Date(e.created_at).toLocaleString()}</span>
                  </div>
                  {eventDetail(e) ? <div className="text-muted-foreground">{eventDetail(e)}</div> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          )}
        </CardContent>
      </Card>

      {consume ? <BuildConsumeDialog request={r} mode={consume} open onOpenChange={(o) => !o && setConsume(null)} /> : null}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && closeDialog()}>
        {current && dialog ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{current.title}</DialogTitle>
              <DialogDescription>{current.body}</DialogDescription>
            </DialogHeader>
            {current.needsNote ? (
              <div className="space-y-2">
                <Label htmlFor="build-action-note">Reason</Label>
                <Textarea
                  id="build-action-note"
                  rows={3}
                  placeholder={dialog === "reject" ? "e.g. wrong system for this site, or quantity needs confirming" : "e.g. project scope changed, or wrong system started"}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Back</Button>
              <Button
                variant={current.destructive ? "destructive" : "default"}
                onClick={() => act.mutate(dialog)}
                disabled={act.isPending || (current.needsNote && !note.trim())}
              >
                {act.isPending ? "Saving…" : current.action}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
