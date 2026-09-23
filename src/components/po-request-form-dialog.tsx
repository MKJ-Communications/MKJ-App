import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, Trash } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TypedItemBadge } from "@/components/po-request-status-badge";
import { useRequestableProjects, type PoRequest } from "@/lib/po-requests";

type ProductOption = { id: string; part_number: string; description: string; unit: string };
type DraftLine = { key: number; product_id: string | null; custom_description: string; qty: number; unit: string };

const LINE_GRID = "grid grid-cols-[1.5rem_minmax(0,1fr)_4.5rem_4.5rem_2.25rem] items-center gap-2";

/** Create a PO request, or edit one that's still pending (pass `request`). */
export function PORequestFormDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request?: PoRequest | null;
}) {
  const qc = useQueryClient();
  const editing = !!request;
  const keyRef = useRef(0);

  const [projectId, setProjectId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);

  // Start fresh each time the dialog opens: from the request being edited, or blank.
  useEffect(() => {
    if (!open) return;
    setProjectId(request?.project_id ?? "");
    setNotes(request?.notes ?? "");
    setLines(
      request
        ? request.lines.map((l) => ({
            key: ++keyRef.current,
            product_id: l.product_id,
            custom_description: l.custom_description ?? "",
            qty: l.qty,
            unit: l.unit,
          }))
        : [{ key: ++keyRef.current, product_id: null, custom_description: "", qty: 1, unit: "ea" }],
    );
  }, [open, request]);

  const projects = useRequestableProjects(open && !editing);
  const products = useQuery({
    queryKey: ["products", "request-picker"],
    enabled: open,
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await supabase.from("products").select("id, part_number, description, unit").order("part_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { key: ++keyRef.current, product_id: null, custom_description: "", qty: 1, unit: "ea" }]);
  }
  function removeLine(key: number) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!editing && !projectId) throw new Error("Choose a project");
      if (lines.length === 0) throw new Error("Add at least one line");
      const payload = lines.map((l, i) => {
        const typed = l.custom_description.trim();
        if (!l.product_id && !typed) throw new Error(`Line ${i + 1}: pick a product or type what you need`);
        if (!Number.isInteger(l.qty) || l.qty < 1) throw new Error(`Line ${i + 1}: quantity must be a whole number above zero`);
        return l.product_id
          ? { product_id: l.product_id, qty: l.qty, unit: l.unit.trim() }
          : { custom_description: typed, qty: l.qty, unit: l.unit.trim() };
      });
      if (editing) {
        const { data, error } = await supabase.rpc("update_po_request", { _request_id: request!.id, _notes: notes, _lines: payload });
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.rpc("create_po_request", { _project_id: projectId, _notes: notes, _lines: payload });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const number = data?.request_number ?? "Request";
      toast.success(editing ? `${number} updated` : `${number} sent to the warehouse`);
      qc.invalidateQueries({ queryKey: ["po-requests"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${request!.request_number}` : "Request a PO"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Your changes replace the request's items and notes. You can edit it until the warehouse completes it."
              : "The warehouse is notified as soon as you submit. You can edit the request until it's completed."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
              <p className="text-xs text-muted-foreground">You don't manage any active projects yet, so there's nothing to request for.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <Button type="button" size="sm" variant="outline" onClick={addLine}><Plus className="mr-1 h-4 w-4" />Add line</Button>
            </div>
            <div className={cn(LINE_GRID, "text-xs font-medium text-muted-foreground")}>
              <span className="text-center">#</span><span>Product</span><span className="text-right">Qty</span><span>Unit</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={l.key} className={LINE_GRID}>
                <span className="text-center text-xs text-muted-foreground">{i + 1}</span>
                <ProductPicker products={products.data ?? []} line={l} onPick={(patch) => updateLine(l.key, patch)} />
                <Input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  className="text-right"
                  aria-label={`Line ${i + 1} quantity`}
                  value={l.qty}
                  onChange={(e) => updateLine(l.key, { qty: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                />
                <Input aria-label={`Line ${i + 1} unit`} value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove line ${i + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => removeLine(l.key)}
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="po-request-notes">Notes for the warehouse</Label>
            <Textarea
              id="po-request-notes"
              rows={3}
              placeholder="Needed-by date, delivery site, preferred supplier…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!editing && !projectId)}>
            {save.isPending ? "Saving…" : editing ? "Save changes" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Searchable product list for one line. When nothing matches, the last
 * option uses the search text as a typed item — typed items stay on the
 * request only and are never added to the products list.
 */
function ProductPicker({
  products,
  line,
  onPick,
}: {
  products: ProductOption[];
  line: DraftLine;
  onPick: (patch: Partial<DraftLine>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = line.product_id ? products.find((p) => p.id === line.product_id) ?? null : null;
  const typed = search.trim();

  function close() {
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <span className="truncate"><span className="font-mono text-xs">{selected.part_number}</span> — {selected.description}</span>
            ) : line.custom_description ? (
              <>
                <span className="truncate">{line.custom_description}</span>
                <TypedItemBadge />
              </>
            ) : (
              <span className="text-muted-foreground">Search products or type an item…</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Part number or description…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>Start typing to search the products list.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.part_number} ${p.description}`}
                  onSelect={() => {
                    onPick({ product_id: p.id, custom_description: "", unit: p.unit });
                    close();
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", line.product_id === p.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex flex-col">
                    <span className="font-mono text-sm">{p.part_number}</span>
                    <span className="text-xs text-muted-foreground">{p.description}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {typed ? (
              <CommandGroup heading="Not in the products list?">
                <CommandItem
                  forceMount
                  value={`typed-item ${typed}`}
                  onSelect={() => {
                    onPick({ product_id: null, custom_description: typed });
                    close();
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />Use “{typed}” as typed
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
