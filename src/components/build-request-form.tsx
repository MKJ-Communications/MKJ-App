import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Plus, Trash } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { LineOriginBadge, LineStockState } from "@/components/build-request-status-badge";
import {
  computeCoverage,
  lineOrigin,
  round2,
  useBuildableProjects,
  useProjectAvailable,
  type BuildRequest,
} from "@/lib/build-requests";
import { formatQty, useSystemTemplates } from "@/lib/system-templates";
import { useRoles } from "@/hooks/use-session";
import { isWarehouseOrAdmin } from "@/lib/roles";

type ProductOption = { id: string; part_number: string; description: string; unit: string };
type DraftLine = {
  key: number;
  product_id: string;
  qty_per_unit: number;
  // What the system's parts list says for this part; null for a part the requester added.
  template: { qty: number; is_key_part: boolean } | null;
};

/** New build request, or edit a draft/rejected one (pass `request`). */
export function BuildRequestForm({ request }: { request?: BuildRequest }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editing = !!request;
  const keyRef = useRef(0);

  const [projectId, setProjectId] = useState(request?.project_id ?? "");
  const [templateId, setTemplateId] = useState(request?.template_id ?? "");
  const [qty, setQty] = useState(request?.qty ?? 1);
  const [notes, setNotes] = useState(request?.notes ?? "");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  const projects = useBuildableProjects(!editing);
  // Warehouse managers and admins may request builds for any project; managers only their own.
  const allProjects = isWarehouseOrAdmin(useRoles().data ?? []);
  const templates = useSystemTemplates();
  const products = useQuery({
    queryKey: ["products", "build-picker"],
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await supabase.from("products").select("id, part_number, description, unit").order("part_number");
      if (error) throw error;
      return data ?? [];
    },
  });
  const available = useProjectAvailable(projectId || null);
  // The warehouse changing a submitted request: what it already holds is
  // available to its own lines again, on top of the project's free stock.
  const submittedEdit = request?.status === "submitted";
  const availableForLines = useMemo(() => {
    const base = new Map(available.data ?? []);
    if (submittedEdit) {
      for (const l of request!.lines) base.set(l.product_id, (base.get(l.product_id) ?? 0) + (l.qty_held - l.qty_consumed));
    }
    return base;
  }, [available.data, submittedEdit, request]);

  const template = templates.data?.find((t) => t.id === templateId) ?? null;
  const productById = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);

  // Editing: start from the request's own parts list once the systems are
  // loaded, so each line knows what the system says (Changed / Added badges).
  useEffect(() => {
    if (!request || loadedFrom === request.id || !templates.data) return;
    const t = templates.data.find((x) => x.id === request.template_id);
    setLines(
      request.lines.map((l) => {
        const tp = t?.parts.find((p) => p.product_id === l.product_id);
        return {
          key: ++keyRef.current,
          product_id: l.product_id,
          qty_per_unit: l.qty_per_unit,
          template: tp ? { qty: tp.qty_per_system, is_key_part: tp.is_key_part } : null,
        };
      }),
    );
    setLoadedFrom(request.id);
  }, [request, templates.data, loadedFrom]);

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const t = templates.data?.find((x) => x.id === id);
    setLines(
      (t?.parts ?? []).map((p) => ({
        key: ++keyRef.current,
        product_id: p.product_id,
        qty_per_unit: p.qty_per_system,
        template: { qty: p.qty_per_system, is_key_part: p.is_key_part },
      })),
    );
  }
  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: number) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }
  function addPart(p: ProductOption) {
    setLines((ls) => [...ls, { key: ++keyRef.current, product_id: p.id, qty_per_unit: 1, template: null }]);
  }

  const coverage = computeCoverage(
    lines.map((l) => ({
      product_id: l.product_id,
      part_number: productById.get(l.product_id)?.part_number ?? "…",
      is_key_part: l.template?.is_key_part ?? false,
      required: round2(l.qty_per_unit * qty),
    })),
    availableForLines,
  );
  const pendingParts = coverage.rows.filter((r) => !r.covered).length;
  const canSave =
    !!projectId && !!templateId && Number.isInteger(qty) && qty >= 1 && lines.length > 0 && lines.every((l) => l.qty_per_unit > 0);

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!canSave) throw new Error("Choose a project, a system, how many units, and at least one part");
      const payload = lines.map((l) => ({ product_id: l.product_id, qty_per_unit: l.qty_per_unit })) as unknown as Json;
      let id: string;
      if (request) {
        const { error } = await supabase.rpc("update_build_request", { _request_id: request.id, _qty: qty, _notes: notes, _lines: payload });
        if (error) throw error;
        id = request.id;
      } else {
        const { data, error } = await supabase.rpc("create_build_request", {
          _project_id: projectId,
          _template_id: templateId,
          _qty: qty,
          _notes: notes,
          _lines: payload,
        });
        if (error) throw error;
        id = (data as { id: string }).id;
      }
      if (!submit) return { id, submitted: false, submitError: null as string | null };
      // Stock can move between the preview and the click, so the database has the final word.
      const { error } = await supabase.rpc("submit_build_request", { _request_id: id });
      return { id, submitted: !error, submitError: error?.message ?? null };
    },
    onSuccess: ({ id, submitted, submitError }) => {
      if (submitError) toast.error(`Saved as a draft, but not submitted: ${submitError}`);
      else if (submittedEdit) toast.success("Parts list updated — holds recalculated and the requester notified");
      else toast.success(submitted ? "Submitted to the shop — the available parts are now held" : "Draft saved");
      qc.invalidateQueries({ queryKey: ["build-requests"] });
      qc.invalidateQueries({ queryKey: ["build-request", id] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      navigate({ to: "/manufacturing/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeTemplates = (templates.data ?? []).filter((t) => t.active);
  const listed = new Set(lines.map((l) => l.product_id));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Project</Label>
            {editing ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-mono">{request!.project_number}</span>
                {request!.project_name ? ` — ${request!.project_name}` : ""}
              </div>
            ) : (
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder={projects.isLoading ? "Loading…" : "Choose project"} /></SelectTrigger>
                <SelectContent>
                  {(projects.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.mkj_number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {!editing && projects.isSuccess && projects.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {allProjects
                  ? "There are no active projects yet. Create one on the Projects page first."
                  : "You don't manage any active projects, so there's nothing to request a build for."}
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label>System</Label>
            {editing ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-mono">{request!.template?.system_code}</span>
                {request!.template?.name ? ` — ${request!.template.name}` : ""}
              </div>
            ) : (
              <Select value={templateId} onValueChange={chooseTemplate}>
                <SelectTrigger><SelectValue placeholder={templates.isLoading ? "Loading…" : "Choose system"} /></SelectTrigger>
                <SelectContent>
                  {activeTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.system_code} — {t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {!editing && templates.isSuccess && activeTemplates.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active systems yet. Import them on the Systems page first.</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="build-qty">Units to build</Label>
            <Input
              id="build-qty"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
            />
          </div>

          <div className="space-y-1 md:col-span-3">
            <Label htmlFor="build-notes">Notes for the shop</Label>
            <Textarea
              id="build-notes"
              rows={2}
              placeholder="Needed-by date, site details, anything that differs from the standard build…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">
            Parts
            {template ? <span className="ml-2 text-sm font-normal text-muted-foreground">for {qty} × {template.system_code}</span> : null}
          </CardTitle>
          {templateId ? <AddPartPicker products={products.data ?? []} exclude={listed} onPick={addPart} /> : null}
        </CardHeader>
        <CardContent className="p-0">
          {templateId ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className="w-28 text-right">Per unit</TableHead>
                  <TableHead className="text-right">Needed</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {coverage.rows.map((row, i) => {
                  const l = lines[i];
                  const p = productById.get(l.product_id);
                  const key = !!l.template?.is_key_part;
                  return (
                    <TableRow key={l.key}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs">{p?.part_number ?? "…"}</span>
                          {key ? <Badge>Key</Badge> : null}
                          <LineOriginBadge origin={lineOrigin(l.template, l.qty_per_unit)} />
                        </div>
                        <div className="text-xs text-muted-foreground">{p?.description}</div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          className="h-8 text-right"
                          aria-label={`${p?.part_number ?? "Part"} quantity per unit`}
                          value={l.qty_per_unit}
                          onChange={(e) => updateLine(l.key, { qty_per_unit: Number(e.target.value) || 0 })}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formatQty(row.required)} <span className="text-xs text-muted-foreground">{p?.unit}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{projectId ? formatQty(row.available) : "—"}</TableCell>
                      <TableCell>
                        {projectId ? <LineStockState covered={row.covered} pending={formatQty(row.required - row.canHold)} /> : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${p?.part_number ?? "part"}`}
                          title={key ? "Key parts can't be removed" : "Remove"}
                          disabled={key}
                          onClick={() => removeLine(l.key)}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No parts. Add at least one.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">Choose a system to load its parts list. You can change quantities and add parts; key parts stay.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm">
          {!projectId || !templateId ? (
            <span className="text-muted-foreground">Choose a project and a system to check the stock.</span>
          ) : coverage.passes ? (
            <span className="inline-flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-received-foreground" />
              <span>
                <strong>{coverage.covered} of {coverage.total} parts</strong> can be fully held ({coverage.pct}%) and every key part is in stock.
                {pendingParts > 0 ? ` ${pendingParts} will stay pending until stock arrives.` : ""} Submitting holds them right away.
              </span>
            </span>
          ) : (
            <span className="inline-flex items-start gap-2 text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{coverage.reason} {submittedEdit ? "Adjust the parts so the rule still passes." : "You can still save it as a draft."}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={() => (request ? navigate({ to: "/manufacturing/$id", params: { id: request.id } }) : navigate({ to: "/manufacturing" }))}
          >
            Cancel
          </Button>
          {submittedEdit ? (
            // Stays submitted: the database re-holds and re-checks the 80% rule on save.
            <Button onClick={() => save.mutate(false)} disabled={!canSave || !coverage.passes || save.isPending || available.isLoading}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => save.mutate(false)} disabled={!canSave || save.isPending}>
                Save draft
              </Button>
              <Button onClick={() => save.mutate(true)} disabled={!canSave || !coverage.passes || save.isPending || available.isLoading}>
                {save.isPending ? "Saving…" : "Submit to the shop"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AddPartPicker({
  products,
  exclude,
  onPick,
}: {
  products: ProductOption[];
  exclude: Set<string>;
  onPick: (p: ProductOption) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />Add part</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder="Part number or description…" />
          <CommandList>
            <CommandEmpty>No matching products.</CommandEmpty>
            <CommandGroup>
              {products.filter((p) => !exclude.has(p.id)).map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.part_number} ${p.description}`}
                  onSelect={() => {
                    onPick(p);
                    setOpen(false);
                  }}
                >
                  <span className="flex flex-col">
                    <span className="font-mono text-sm">{p.part_number}</span>
                    <span className="text-xs text-muted-foreground">{p.description}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
