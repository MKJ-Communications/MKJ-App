import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { BorrowHistory } from "@/components/borrow-history";
import { useInventorySerials, useSerialSupport } from "@/lib/serials";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Inventory — MKJ Ops" }] }),
  component: InventoryPage,
});

type InvRow = {
  project_id: string;
  product_id: string;
  on_hand: number;
  held: number;
  projects: { mkj_number: string; name: string } | null;
  products: { part_number: string; description: string; reorder_point: number } | null;
};

function InventoryPage() {
  const [q, setQ] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const serialsOn = useSerialSupport().data === true;
  const serialsByRow = useInventorySerials(serialsOn);

  const inv = useQuery({
    queryKey: ["inventory", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_project_inventory")
        .select("project_id, product_id, on_hand, held, products:product_id(part_number, description, reorder_point)");
      if (error) throw error;
      const rows = (data ?? []) as unknown as Omit<InvRow, "projects">[];

      // project_id references projects, which a viewer who isn't on that
      // project can't read directly — look names up through the same
      // role-gated, name-only directory used on the borrow-requests page.
      const projectIds = Array.from(new Set(rows.map((r) => r.project_id)));
      let projById: Record<string, { mkj_number: string; name: string }> = {};
      if (projectIds.length > 0) {
        const { data: projs } = await supabase.from("v_project_directory").select("id, mkj_number, name").in("id", projectIds);
        projById = Object.fromEntries((projs ?? []).map((p) => [p.id, { mkj_number: p.mkj_number, name: p.name }]));
      }

      return rows.map((r) => ({ ...r, projects: projById[r.project_id] ?? null })) as InvRow[];
    },
  });

  const lastUpdated = useQuery({
    queryKey: ["inventory", "last-updated"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_project_last_updated" as never)
        .select("project_id, last_updated");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data ?? []) as unknown as Array<{ project_id: string | null; last_updated: string | null }>) {
        if (r.project_id && r.last_updated) map.set(r.project_id, r.last_updated);
      }

      return map;
    },
  });

  const term = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!inv.data) return [];
    let rows = inv.data;
    if (selectedProjectId) {
      rows = rows.filter((r) => r.project_id === selectedProjectId);
    }
    if (!term) return rows;
    return rows.filter((r) => {
      const hay = [
        r.projects?.mkj_number,
        r.projects?.name,
        r.products?.part_number,
        r.products?.description,
        ...(serialsByRow.data?.get(`${r.project_id}:${r.product_id}`) ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [inv.data, term, selectedProjectId, serialsByRow.data]);

  const projectCards = useMemo(() => {
    const seen = new Map<string, { id: string; mkj: string; name: string }>();
    for (const r of filtered) {
      if (r.projects && !seen.has(r.project_id)) {
        seen.set(r.project_id, { id: r.project_id, mkj: r.projects.mkj_number, name: r.projects.name });
      }
    }
    return Array.from(seen.values());
  }, [filtered]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Inventory" description="On-hand quantities across every project. Held stock is reserved for manufacturing build requests." />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search project, part # or description…"
          className="pl-9"
        />
      </div>

      {projectCards.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="grid flex-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {projectCards.map((p) => {
              const updated = lastUpdated.data?.get(p.id);
              const active = selectedProjectId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProjectId(active ? null : p.id)}
                  className="text-left"
                  aria-pressed={active}
                >
                  <Card className={cn(
                    "h-full transition-all hover:shadow-md",
                    active ? "ring-2 ring-primary ring-offset-1" : "",
                  )}>
                    <CardContent className="p-4">
                      <div className="font-mono text-sm font-semibold text-primary">{p.mkj}</div>
                      <div className="mt-1 font-medium">{p.name}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Last updated: {updated ? new Date(updated).toLocaleString() : "—"}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>
          {selectedProjectId ? (
            <Button variant="outline" size="sm" onClick={() => setSelectedProjectId(null)}>
              Clear filter
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Project</TableHead><TableHead>Part #</TableHead><TableHead>Description</TableHead>
            <TableHead className="text-right">On Hand</TableHead><TableHead className="text-right" title="Reserved for manufacturing build requests">Held</TableHead><TableHead className="text-right">Reorder</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length > 0 ? filtered.map((r) => {
              const key = `${r.project_id}:${r.product_id}`;
              const serials = serialsByRow.data?.get(key) ?? [];
              const isOpen = expanded.has(key);
              return (
              <Fragment key={key}>
              <TableRow>
                <TableCell className="font-mono text-xs">
                  {serialsOn && serials.length > 0 ? (
                    <button
                      type="button"
                      aria-label={isOpen ? "Hide serial numbers" : "Show serial numbers"}
                      className="mr-1 align-middle text-muted-foreground"
                      onClick={() => setExpanded((s) => {
                        const next = new Set(s);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      })}
                    >
                      {isOpen ? <ChevronDown className="inline h-3.5 w-3.5" /> : <ChevronRight className="inline h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                  {r.projects?.mkj_number}
                </TableCell>
                <TableCell className="font-mono">
                  {r.products?.part_number}
                  {serialsOn && serials.length > 0 ? (
                    <Badge variant="secondary" className="ml-2">{serials.length} serials</Badge>
                  ) : null}
                </TableCell>
                <TableCell>{r.products?.description}</TableCell>
                <TableCell className="text-right font-semibold">
                  {Number(r.on_hand)}
                  {r.products && Number(r.on_hand) <= (r.products.reorder_point ?? 0) ? <Badge variant="destructive" className="ml-2">Low</Badge> : null}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{Number(r.held) > 0 ? Number(r.held) : "—"}</TableCell>
                <TableCell className="text-right text-muted-foreground">{r.products?.reorder_point ?? 0}</TableCell>
              </TableRow>
              {serialsOn && isOpen ? (
                <TableRow>
                  <TableCell colSpan={6} className="bg-muted/30">
                    <div className="flex flex-wrap gap-1">
                      {serials.map((s) => (
                        <span key={s} className="rounded-full bg-background px-2 py-0.5 font-mono text-[10px]">{s}</span>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              </Fragment>
              );
            }) : <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">{term ? "No matches." : "No stock yet. Record a packing slip to receive goods."}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <BorrowHistory title="Recent borrow movements" />
    </div>

  );
}
