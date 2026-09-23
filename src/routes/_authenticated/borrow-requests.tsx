import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useRoles, useSession } from "@/hooks/use-session";
import { isWarehouseOrAdmin } from "@/lib/roles";
import { BorrowHistory } from "@/components/borrow-history";
import { SerialPickerDialog } from "@/components/serial-picker-dialog";
import { useBorrowSerials, useSerialSupport, useSerializedProducts } from "@/lib/serials";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/borrow-requests")({
  head: () => ({ meta: [{ title: "Borrow Requests — MKJ Ops" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ request: typeof s.request === "string" ? s.request : undefined }),
  component: BorrowPage,
});

type Req = {
  id: string;
  source_project_id: string;
  target_project_id: string;
  product_id: string;
  qty_requested: number;
  qty_approved: number | null;
  status: string;
  reason: string | null;
  decision_note: string | null;
  needed_by: string | null;
  requested_by: string | null;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
  qty_returned?: number | null;
  returned_by?: string | null;
  returned_at?: string | null;
  return_note?: string | null;
  source: { mkj_number: string; name: string } | null;
  target: { mkj_number: string; name: string } | null;
  product: { part_number: string; description: string } | null;
  requester: { full_name: string | null; email: string | null } | null;
  decider: { full_name: string | null; email: string | null } | null;
  returner?: { full_name: string | null; email: string | null } | null;
};

function statusVariant(s: string) {
  if (s === "fulfilled" || s === "approved") return "default" as const;
  if (s === "denied") return "destructive" as const;
  return "secondary" as const;
}
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  partially_approved: "Partially approved",
  denied: "Denied",
  fulfilled: "Fulfilled",
  partially_returned: "Partially returned",
  returned: "Returned",
  cancelled: "Cancelled",
};

function personLabel(p?: { full_name: string | null; email: string | null } | null) {
  return p?.full_name?.trim() || p?.email || "—";
}

function BorrowPage() {
  const { userId } = useSession();
  const { data: roles = [] } = useRoles();
  const navigate = useNavigate({ from: "/borrow-requests" });
  const { request: focusedId } = Route.useSearch();
  const qc = useQueryClient();
  const oversight = isWarehouseOrAdmin(roles);
  const isEngineer = roles.length > 0 && !roles.some((r) => r !== "engineer");

  const list = useQuery({
    queryKey: ["borrow-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("borrow_requests")
        .select("*, product:product_id(part_number, description)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const reqs = (data ?? []) as unknown as Req[];

      // source_project_id/target_project_id reference projects, which a
      // viewer who isn't on that project can't read directly — look their
      // names up through the same role-gated, name-only directory the
      // "Borrow from" picker uses.
      const projectIds = Array.from(new Set(reqs.flatMap((r) => [r.source_project_id, r.target_project_id])));
      let projById: Record<string, { mkj_number: string; name: string }> = {};
      if (projectIds.length > 0) {
        const { data: projs } = await supabase.from("v_project_directory").select("id, mkj_number, name").in("id", projectIds);
        projById = Object.fromEntries((projs ?? []).map((p) => [p.id, { mkj_number: p.mkj_number, name: p.name }]));
      }

      // requested_by/decided_by/returned_by reference auth.users, so profile names are fetched separately
      const ids = Array.from(new Set(reqs.flatMap((r) => [r.requested_by, r.decided_by, r.returned_by ?? null]).filter(Boolean) as string[]));
      let byId: Record<string, { full_name: string | null; email: string | null }> = {};
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("user_directory").select("id, full_name").in("id", ids);
        byId = Object.fromEntries((profs ?? []).map((p) => [p.id, { full_name: p.full_name, email: null }]));
      }
      return reqs.map((r) => ({
        ...r,
        source: projById[r.source_project_id] ?? null,
        target: projById[r.target_project_id] ?? null,
        requester: r.requested_by ? byId[r.requested_by] ?? null : null,
        decider: r.decided_by ? byId[r.decided_by] ?? null : null,
        returner: r.returned_by ? byId[r.returned_by] ?? null : null,
      }));
    },
  });

  const myProjects = useQuery({
    queryKey: ["my-managed-projects", userId],
    enabled: !!userId,
    queryFn: async () => (await supabase.from("project_managers").select("project_id").eq("user_id", userId!)).data?.map((r) => r.project_id) ?? [],
  });

  const projects = useQuery({ queryKey: ["projects"], queryFn: async () => ((await supabase.from("v_project_directory").select("id, mkj_number, name").order("mkj_number")).data ?? []).filter((p): p is { id: string; mkj_number: string; name: string } => !!p.id) });
  const products = useQuery({ queryKey: ["products"], queryFn: async () => (await supabase.from("products").select("id, part_number, description").order("part_number")).data ?? [] });

  const canDecide = (r: Req) => r.status === "pending" && (oversight || (myProjects.data ?? []).includes(r.source_project_id));
  const canReturn = (r: Req) =>
    (r.status === "fulfilled" || r.status === "partially_returned") &&
    (oversight || (myProjects.data ?? []).includes(r.target_project_id));
  const canCancel = (r: Req) => r.status === "pending" && r.requested_by === userId;

  const [tab, setTab] = useState("all");
  const rows = useMemo(() => {
    const all = list.data ?? [];
    if (tab === "mine") return all.filter((r) => r.requested_by === userId);
    if (tab === "approval") return all.filter(canDecide);
    return all;
  }, [list.data, tab, userId, oversight, myProjects.data]);

  const pendingForMe = (list.data ?? []).filter(canDecide).length;
  const focused = (list.data ?? []).find((r) => r.id === focusedId) ?? null;

  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [neededBy, setNeededBy] = useState("");

  // Serial tracking only appears once the backend schema is in place, and
  // only for parts flagged serialized — same gate as receiving/shipping.
  const serialsOn = useSerialSupport().data === true;
  const serializedProducts = useSerializedProducts(serialsOn);
  const isSerialized = (productId?: string | null) =>
    serialsOn && !!productId && (serializedProducts.data?.has(productId) ?? false);

  const [approving, setApproving] = useState<Req | null>(null);
  const [approveQty, setApproveQty] = useState(1);
  const [approveSerials, setApproveSerials] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const openApprove = (r: Req) => {
    setApproving(r);
    setApproveQty(Number(r.qty_requested));
    setApproveSerials([]);
    setNote("");
  };

  const [returning, setReturning] = useState<Req | null>(null);
  const [returnQty, setReturnQty] = useState(1);
  const [returnSerials, setReturnSerials] = useState<string[]>([]);
  const [returnNote, setReturnNote] = useState("");
  const outstanding = returning ? Math.max(0, Number(returning.qty_approved ?? 0) - Number(returning.qty_returned ?? 0)) : 0;
  const openReturn = (r: Req) => {
    setReturning(r);
    setReturnQty(Math.max(1, Number(r.qty_approved ?? 0) - Number(r.qty_returned ?? 0)));
    setReturnSerials([]);
    setReturnNote("");
  };

  // Which specific units this request still has out — the only valid
  // choices when returning, and what the detail panel lists.
  const returningSerials = useBorrowSerials(returning?.id, serialsOn && isSerialized(returning?.product_id));
  const returnCandidates = (returningSerials.data ?? []).filter((s) => !s.returned_at).map((s) => s.serial);

  const focusedSerials = useBorrowSerials(focused?.id, serialsOn && isSerialized(focused?.product_id));

  const onHand = useQuery({
    queryKey: ["onhand", sourceId, productId],
    enabled: !!sourceId && !!productId,
    queryFn: async () => {
      const { data } = await supabase.from("v_project_inventory").select("available").eq("project_id", sourceId).eq("product_id", productId).maybeSingle();
      return Number(data?.available ?? 0);
    },
  });

  const approveOnHand = useQuery({
    queryKey: ["onhand", approving?.source_project_id, approving?.product_id],
    enabled: !!approving,
    queryFn: async () => {
      const { data } = await supabase.from("v_project_inventory").select("available").eq("project_id", approving!.source_project_id).eq("product_id", approving!.product_id).maybeSingle();
      return Number(data?.available ?? 0);
    },
  });

  const returnOnHand = useQuery({
    queryKey: ["onhand", returning?.target_project_id, returning?.product_id],
    enabled: !!returning,
    queryFn: async () => {
      const { data } = await supabase.from("v_project_inventory").select("available").eq("project_id", returning!.target_project_id).eq("product_id", returning!.product_id).maybeSingle();
      return Number(data?.available ?? 0);
    },
  });

  const returnStock = useMutation({
    mutationFn: async ({ req, qty, note, serials }: { req: Req; qty: number; note?: string; serials?: string[] }) => {
      const { error } = await supabase.rpc("return_borrowed_stock" as never, {
        _request_id: req.id,
        _qty: qty,
        _note: note || null,
        // Left out entirely when nothing was picked, so the call still
        // works against the pre-serial signature if this deploy happens to
        // land before the migration.
        ...(serials && serials.length > 0 ? { _serials: serials } : {}),
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Return recorded — stock moved back to the lending project");
      setReturning(null); setReturnNote(""); setReturnSerials([]);
      qc.invalidateQueries({ queryKey: ["borrow-requests"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["borrow-history"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["borrow-serials"] });
      qc.invalidateQueries({ queryKey: ["inventory-serials"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const create = useMutation({
    mutationFn: async () => {
      if (sourceId === targetId) throw new Error("Source and target projects must differ");
      const { error } = await supabase.from("borrow_requests").insert({
        source_project_id: sourceId, target_project_id: targetId, product_id: productId,
        qty_requested: qty, reason: reason || null, needed_by: neededBy || null, requested_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Borrow request submitted — the lending project's manager has been notified");
      setOpen(false);
      setSourceId(""); setTargetId(""); setProductId(""); setQty(1); setReason(""); setNeededBy("");
      qc.invalidateQueries({ queryKey: ["borrow-requests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: async ({ req, status, qty_approved, note, serials }: { req: Req; status: "approved" | "denied" | "partially_approved"; qty_approved?: number; note?: string; serials?: string[] }) => {
      const { error } = await supabase.rpc("decide_borrow_request", {
        _request_id: req.id,
        _status: status,
        _qty_approved: (qty_approved ?? null) as unknown as number,
        _note: (note || null) as unknown as string,
        ...(serials && serials.length > 0 ? { _serials: serials } : {}),
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Decision recorded — both projects have been notified");
      setApproving(null); setNote(""); setApproveSerials([]);
      qc.invalidateQueries({ queryKey: ["borrow-requests"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["borrow-history"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["borrow-serials"] });
      qc.invalidateQueries({ queryKey: ["inventory-serials"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("borrow_requests").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request withdrawn");
      qc.invalidateQueries({ queryKey: ["borrow-requests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Borrow Requests"
        description="Move stock between projects. Requires approval from the lending project's manager."
        actions={
          isEngineer ? null : (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />New Request</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Request to borrow</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Borrow from (lending project)</Label>
                    <Select value={sourceId} onValueChange={setSourceId}>
                      <SelectTrigger><SelectValue placeholder="Source project" /></SelectTrigger>
                      <SelectContent>{projects.data?.filter((p) => p.id !== targetId && !(myProjects.data ?? []).includes(p.id)).map((p) => <SelectItem key={p.id} value={p.id}>{p.mkj_number} — {p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>For (my project)</Label>
                    <Select value={targetId} onValueChange={setTargetId}>
                      <SelectTrigger><SelectValue placeholder="Target project" /></SelectTrigger>
                      <SelectContent>{projects.data?.filter((p) => p.id !== sourceId && (oversight || (myProjects.data ?? []).includes(p.id))).map((p) => <SelectItem key={p.id} value={p.id}>{p.mkj_number} — {p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Product</Label>
                    <Select value={productId} onValueChange={setProductId}>
                      <SelectTrigger><SelectValue placeholder="Choose product" /></SelectTrigger>
                      <SelectContent>{products.data?.map((p) => <SelectItem key={p.id} value={p.id}>{p.part_number} — {p.description}</SelectItem>)}</SelectContent>
                    </Select>
                    {sourceId && productId ? (
                      <p className="mt-1 text-xs text-muted-foreground">Available at source: <span className="font-mono font-semibold">{onHand.data ?? 0}</span></p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Qty</Label><Input type="number" min={1} step={1} inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} /></div>
                    <div><Label>Needed by</Label><Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></div>
                  </div>
                  <div><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={() => create.mutate()} disabled={!sourceId || !targetId || !productId || create.isPending}>{create.isPending ? "Submitting…" : "Submit"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="approval">
            Needs my approval{pendingForMe > 0 ? <Badge variant="destructive" className="ml-2">{pendingForMe}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="mine">My requests</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Product</TableHead><TableHead>From</TableHead><TableHead>To</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead>Needed by</TableHead><TableHead>Status</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {rows.length > 0 ? rows.map((r) => (
              <TableRow key={r.id} className={r.id === focusedId ? "bg-accent/40" : undefined}>
                <TableCell>
                  <button className="text-left" onClick={() => navigate({ search: { request: r.id } })}>
                    <div className="font-mono text-primary hover:underline">{r.product?.part_number}</div>
                    <div className="text-xs text-muted-foreground">{r.product?.description}</div>
                  </button>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.source?.mkj_number}</TableCell>
                <TableCell className="font-mono text-xs">{r.target?.mkj_number}</TableCell>
                <TableCell className="text-right">
                  {Number(r.qty_requested)}{r.qty_approved != null ? ` (approved ${Number(r.qty_approved)})` : ""}
                  {Number(r.qty_returned ?? 0) > 0 ? (
                    <div className="text-xs text-muted-foreground">{Number(r.qty_returned ?? 0)} of {Number(r.qty_approved ?? 0)} returned</div>
                  ) : null}
                </TableCell>
                <TableCell>{r.needed_by ?? "—"}</TableCell>
                <TableCell><Badge variant={statusVariant(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
                <TableCell className="space-x-1 text-right">
                  {canDecide(r) ? (
                    <>
                      <Button size="sm" onClick={() => openApprove(r)}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => decide.mutate({ req: r, status: "denied" })}>Deny</Button>
                    </>
                  ) : null}
                  {canReturn(r) ? (
                    <Button size="sm" variant="outline" onClick={() => openReturn(r)}>Return</Button>
                  ) : null}
                  {canCancel(r) ? (
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>Cancel</Button>
                  ) : null}
                </TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
              {tab === "approval" ? "Nothing waiting on you." : tab === "mine" ? "You haven't requested anything yet." : "No borrow requests yet."}
            </TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <BorrowHistory />

      {/* Approve dialog — supports partial approval */}
      <Dialog open={!!approving} onOpenChange={(o) => { if (!o) setApproving(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve borrow request</DialogTitle></DialogHeader>
          {approving ? (
            <div className="space-y-3 text-sm">
              <div className="text-muted-foreground">
                {approving.target?.mkj_number} requested <span className="font-semibold text-foreground">{Number(approving.qty_requested)}</span> x{" "}
                <span className="font-mono text-foreground">{approving.product?.part_number}</span> from {approving.source?.mkj_number}.
              </div>
              <div>
                <Label>Approved quantity</Label>
                <Input type="number" min={1} max={Number(approving.qty_requested)} step={1} inputMode="numeric" value={approveQty}
                  onChange={(e) => setApproveQty(Math.min(Number(approving.qty_requested), Math.max(1, Math.trunc(Number(e.target.value) || 1))))} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Available at {approving.source?.mkj_number}: <span className="font-mono font-semibold">{approveOnHand.data ?? 0}</span>
                  {approveQty < Number(approving.qty_requested) ? " — this will be recorded as a partial approval." : ""}
                </p>
              </div>
              {isSerialized(approving.product_id) ? (
                <div>
                  <Label>Serial numbers being sent</Label>
                  <SerialPickerDialog
                    projectId={approving.source_project_id}
                    productId={approving.product_id}
                    qty={approveQty}
                    selected={approveSerials.slice(0, approveQty)}
                    onChange={setApproveSerials}
                    hint={`Pick up to ${approveQty} unit(s) held by ${approving.source?.mkj_number ?? "the lending project"}.`}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Naming units is optional — the transfer goes through either way, but only named
                    serials follow the stock to {approving.target?.mkj_number}.
                  </p>
                </div>
              ) : null}
              <div><Label>Note (optional)</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancel</Button>
            <Button
              disabled={decide.isPending || !approving || approveQty > (approveOnHand.data ?? 0) || (!!approving && approveQty > Number(approving.qty_requested))}
              onClick={() => approving && decide.mutate({
                req: approving,
                status: approveQty < Number(approving.qty_requested) ? "partially_approved" : "approved",
                qty_approved: approveQty,
                note,
                serials: approveSerials.slice(0, approveQty),
              })}
            >{decide.isPending ? "Saving…" : "Approve & transfer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return dialog — supports partial returns */}
      <Dialog open={!!returning} onOpenChange={(o) => { if (!o) setReturning(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Return borrowed stock</DialogTitle></DialogHeader>
          {returning ? (
            <div className="space-y-3 text-sm">
              <div className="text-muted-foreground">
                {returning.target?.mkj_number} borrowed <span className="font-semibold text-foreground">{Number(returning.qty_approved ?? 0)}</span> x{" "}
                <span className="font-mono text-foreground">{returning.product?.part_number}</span> from {returning.source?.mkj_number}.
              </div>
              <div className="text-muted-foreground">
                Already returned: <span className="font-mono font-semibold text-foreground">{Number(returning.qty_returned ?? 0)}</span>
                {" · "}Outstanding: <span className="font-mono font-semibold text-foreground">{outstanding}</span>
              </div>
              <div>
                <Label>Quantity to return</Label>
                <Input type="number" min={1} step={1} inputMode="numeric" value={returnQty}
                  onChange={(e) => setReturnQty(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Available at {returning.target?.mkj_number}: <span className="font-mono font-semibold">{returnOnHand.data ?? 0}</span>
                  {returnQty > outstanding ? " — exceeds the outstanding amount." : returnQty > (returnOnHand.data ?? 0) ? " — exceeds available stock." : returnQty < outstanding ? " — this will be recorded as a partial return." : ""}
                </p>
              </div>
              {isSerialized(returning.product_id) && returnCandidates.length > 0 ? (
                <div>
                  <Label>Serial numbers coming back</Label>
                  <SerialPickerDialog
                    projectId={returning.target_project_id}
                    productId={returning.product_id}
                    qty={returnQty}
                    selected={returnSerials.slice(0, returnQty)}
                    onChange={setReturnSerials}
                    candidates={returnCandidates}
                    hint={`Pick up to ${returnQty} of the unit(s) this request still has out.`}
                  />
                </div>
              ) : null}
              <div><Label>Note (optional)</Label><Textarea value={returnNote} onChange={(e) => setReturnNote(e.target.value)} /></div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)}>Cancel</Button>
            <Button
              disabled={returnStock.isPending || !returning || returnQty > outstanding || returnQty > (returnOnHand.data ?? 0)}
              onClick={() => returning && returnStock.mutate({ req: returning, qty: returnQty, note: returnNote, serials: returnSerials.slice(0, returnQty) })}
            >{returnStock.isPending ? "Saving…" : "Return stock"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail panel (deep link target from notifications) */}
      <Dialog open={!!focused} onOpenChange={(o) => { if (!o) navigate({ search: { request: undefined } }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Borrow request</DialogTitle></DialogHeader>
          {focused ? (
            <div className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Product: </span><span className="font-mono">{focused.product?.part_number}</span> — {focused.product?.description}</div>
              <div><span className="text-muted-foreground">From: </span>{focused.source?.mkj_number} — {focused.source?.name}</div>
              <div><span className="text-muted-foreground">To: </span>{focused.target?.mkj_number} — {focused.target?.name}</div>
              <div><span className="text-muted-foreground">Quantity requested: </span>{Number(focused.qty_requested)}</div>
              {focused.qty_approved != null ? <div><span className="text-muted-foreground">Quantity approved: </span>{Number(focused.qty_approved)}</div> : null}
              {Number(focused.qty_returned ?? 0) > 0 ? (
                <div><span className="text-muted-foreground">Returned: </span>{Number(focused.qty_returned ?? 0)} of {Number(focused.qty_approved ?? 0)}</div>
              ) : null}
              {isSerialized(focused.product_id) && (focusedSerials.data ?? []).length > 0 ? (
                <div>
                  <span className="text-muted-foreground">Serial numbers: </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(focusedSerials.data ?? []).map((s) => (
                      <span
                        key={s.serial}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]",
                          s.returned_at ? "bg-muted text-muted-foreground" : "bg-accent",
                        )}
                        title={s.returned_at ? `Returned ${new Date(s.returned_at).toLocaleString()}` : `At ${focused.target?.mkj_number ?? "the borrowing project"}`}
                      >
                        {s.serial}
                        <span className="font-sans">{s.returned_at ? "returned" : `at ${focused.target?.mkj_number ?? "borrower"}`}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <div><span className="text-muted-foreground">Status: </span><Badge variant={statusVariant(focused.status)}>{STATUS_LABEL[focused.status] ?? focused.status}</Badge></div>
              <div><span className="text-muted-foreground">Requested by: </span>{personLabel(focused.requester)} on {new Date(focused.created_at).toLocaleString()}</div>
              <div><span className="text-muted-foreground">Needed by: </span>{focused.needed_by ?? "—"}</div>
              <div><span className="text-muted-foreground">Reason: </span>{focused.reason ?? "—"}</div>
              {focused.decided_at ? (
                <div><span className="text-muted-foreground">Decision: </span>{personLabel(focused.decider)} on {new Date(focused.decided_at).toLocaleString()}</div>
              ) : null}
              {focused.returned_at ? (
                <div><span className="text-muted-foreground">Last return: </span>{personLabel(focused.returner)} on {new Date(focused.returned_at).toLocaleString()}</div>
              ) : null}
              {focused.decision_note ? <div><span className="text-muted-foreground">Note: </span>{focused.decision_note}</div> : null}
              {focused.return_note ? <div><span className="text-muted-foreground">Return note: </span>{focused.return_note}</div> : null}
              <div className="flex gap-2 pt-2">
                {canDecide(focused) ? (
                  <>
                    <Button size="sm" onClick={() => { openApprove(focused); navigate({ search: { request: undefined } }); }}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => decide.mutate({ req: focused, status: "denied" })}>Deny</Button>
                  </>
                ) : null}
                {canReturn(focused) ? (
                  <Button size="sm" variant="outline" onClick={() => { openReturn(focused); navigate({ search: { request: undefined } }); }}>Return</Button>
                ) : null}
                {canCancel(focused) ? <Button size="sm" variant="ghost" onClick={() => cancel.mutate(focused.id)}>Withdraw request</Button> : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
