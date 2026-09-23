import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useRoles, useSession } from "@/hooks/use-session";
import { PORequestStatusBadge, TypedItemBadge } from "@/components/po-request-status-badge";
import { requestPermissions, useMyManagedProjectIds, type PoRequest } from "@/lib/po-requests";

export type RequestAction = "complete" | "cancel" | null;

/** Request details, plus Edit / Cancel / Mark completed for whoever may do them. */
export function PORequestViewDialog({
  request,
  open,
  onOpenChange,
  initialAction = null,
  onEdit,
}: {
  request: PoRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAction?: RequestAction;
  onEdit: (request: PoRequest) => void;
}) {
  const qc = useQueryClient();
  const { userId } = useSession();
  const roles = useRoles().data ?? [];
  const managed = useMyManagedProjectIds().data ?? [];
  const [action, setAction] = useState<RequestAction>(null);
  const [poRef, setPoRef] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setAction(initialAction);
    setPoRef("");
    setReason("");
  }, [open, request?.id, initialAction]);

  function finish(message: string) {
    toast.success(message);
    qc.invalidateQueries({ queryKey: ["po-requests"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    onOpenChange(false);
  }

  const complete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("complete_po_request", { _request_id: request!.id, _po_reference: poRef });
      if (error) throw error;
    },
    onSuccess: () => finish(`${request!.request_number} marked completed`),
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Give a reason for cancelling");
      const { error } = await supabase.rpc("cancel_po_request", { _request_id: request!.id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => finish(`${request!.request_number} cancelled`),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!request) return null;

  const perms = requestPermissions(request, roles, managed);
  // Only show an action form the viewer is actually allowed to use.
  const activeAction: RequestAction =
    action === "complete" && perms.canComplete ? "complete" : action === "cancel" && perms.canCancel ? "cancel" : null;
  const who = (id: string | null, name: string | null) => (id && id === userId ? "You" : name ?? "Unknown user");
  const when = (ts: string | null) => (ts ? new Date(ts).toLocaleString() : "—");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{request.request_number}</span>
            <PORequestStatusBadge status={request.status} />
          </DialogTitle>
          <DialogDescription>
            PO request for <span className="font-mono">{request.project_number}</span>
            {request.project_name ? ` — ${request.project_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Requested by</dt>
          <dd>{who(request.requested_by, request.requester_name)} · {when(request.created_at)}</dd>
          {request.status === "completed" ? (
            <>
              <dt className="text-muted-foreground">Completed by</dt>
              <dd>{who(request.completed_by, request.completer_name)} · {when(request.completed_at)}</dd>
              <dt className="text-muted-foreground">PO reference</dt>
              <dd className="font-mono">{request.po_reference ?? "—"}</dd>
            </>
          ) : null}
          {request.status === "cancelled" ? (
            <>
              <dt className="text-muted-foreground">Cancelled by</dt>
              <dd>{who(request.cancelled_by, request.canceller_name)} · {when(request.cancelled_at)}</dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{request.cancel_reason}</dd>
            </>
          ) : null}
        </dl>

        {request.notes ? (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</div>
            <p className="whitespace-pre-wrap">{request.notes}</p>
          </div>
        ) : null}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="w-20 text-right">Qty</TableHead>
                <TableHead className="w-20">Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.line_no}</TableCell>
                  <TableCell>
                    {l.product ? (
                      <><span className="font-mono text-xs">{l.product.part_number}</span> — {l.product.description}</>
                    ) : (
                      <span className="inline-flex items-center gap-2">{l.custom_description}<TypedItemBadge /></span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                  <TableCell>{l.unit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {activeAction === "complete" ? (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="po-request-ref">PO reference (optional)</Label>
            <Input id="po-request-ref" placeholder="e.g. MKJ2403EX015" value={poRef} onChange={(e) => setPoRef(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {who(request.requested_by, request.requester_name) === "You" ? "The project's managers" : who(request.requested_by, request.requester_name)} will be notified. This can't be undone.
            </p>
          </div>
        ) : activeAction === "cancel" ? (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="po-request-reason">Reason for cancelling</Label>
            <Textarea
              id="po-request-reason"
              rows={2}
              placeholder="e.g. duplicate of another request, or already ordered"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          {activeAction === "complete" ? (
            <>
              <Button variant="outline" onClick={() => setAction(null)}>Back</Button>
              <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
                {complete.isPending ? "Saving…" : "Mark completed"}
              </Button>
            </>
          ) : activeAction === "cancel" ? (
            <>
              <Button variant="outline" onClick={() => setAction(null)}>Back</Button>
              <Button variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending || !reason.trim()}>
                {cancel.isPending ? "Cancelling…" : "Cancel request"}
              </Button>
            </>
          ) : (
            <>
              {perms.canEdit ? <Button variant="outline" onClick={() => onEdit(request)}>Edit</Button> : null}
              {perms.canCancel ? <Button variant="outline" onClick={() => setAction("cancel")}>Cancel request</Button> : null}
              {perms.canComplete ? <Button onClick={() => setAction("complete")}>Mark completed</Button> : null}
              {!perms.canEdit && !perms.canCancel && !perms.canComplete ? (
                <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
