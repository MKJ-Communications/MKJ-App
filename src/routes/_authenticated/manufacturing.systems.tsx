import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, EyeOff, ListTree, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { SystemImportDialog } from "@/components/system-import-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRoles } from "@/hooks/use-session";
import { canWrite } from "@/lib/roles";
import {
  SYSTEM_CATEGORY_LABELS,
  SYSTEMS_TEMPLATE_URL,
  formatQty,
  useSystemTemplates,
  type SystemTemplate,
} from "@/lib/system-templates";

export const Route = createFileRoute("/_authenticated/manufacturing/systems")({
  head: () => ({ meta: [{ title: "Manufacturing — MKJ Ops" }] }),
  component: SystemsPage,
});

function SystemsPage() {
  const { data: roles = [] } = useRoles();
  // Same rule as the import/activate RPCs: managers, warehouse managers, admins.
  const canManage = canWrite(roles);
  const qc = useQueryClient();
  const templates = useSystemTemplates();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [viewing, setViewing] = useState<SystemTemplate | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const term = q.trim().toLowerCase();
  const all = useMemo(() => templates.data ?? [], [templates.data]);
  const inactiveCount = all.filter((t) => !t.active).length;
  const filtered = useMemo(
    () =>
      all.filter((t) => {
        if (!showInactive && !t.active) return false;
        if (!term) return true;
        return [t.system_code, t.name, t.description].filter(Boolean).join(" ").toLowerCase().includes(term);
      }),
    [all, showInactive, term],
  );

  const setActive = useMutation({
    mutationFn: async ({ t, active }: { t: SystemTemplate; active: boolean }) => {
      const { error } = await supabase.rpc("set_system_template_active", { _template_id: t.id, _active: active });
      if (error) throw error;
      return { t, active };
    },
    onSuccess: ({ t, active }) => {
      toast.success(active ? `${t.system_code} is active again` : `${t.system_code} hidden from new build requests`);
      qc.invalidateQueries({ queryKey: ["system-templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Manufacturing systems"
        description="Standard systems the shop builds, with the parts for one unit of each. Download the template, fill it in, and import it here — this is separate from Bulk Upload."
        backTo="/manufacturing"
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={SYSTEMS_TEMPLATE_URL} download="mkj-ops-manufacturing-systems-template.xlsx">
                <Download className="mr-2 h-4 w-4" /> Download template
              </a>
            </Button>
            {canManage ? (
              <Button onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" /> Import systems
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name or description…" className="pl-9" />
        </div>
        {inactiveCount > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(v === true)} />
            Show inactive ({inactiveCount})
          </label>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Parts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : filtered.length > 0 ? (
                filtered.map((t) => {
                  const keyCount = t.parts.filter((p) => p.is_key_part).length;
                  return (
                    <TableRow key={t.id} className={t.active ? undefined : "text-muted-foreground"}>
                      <TableCell className="font-mono">{t.system_code}</TableCell>
                      <TableCell>
                        {t.name}
                        {t.description ? <div className="text-xs text-muted-foreground">{t.description}</div> : null}
                      </TableCell>
                      <TableCell>{SYSTEM_CATEGORY_LABELS[t.category]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.parts.length}
                        {keyCount > 0 ? <span className="text-xs text-muted-foreground"> · {keyCount} key</span> : null}
                      </TableCell>
                      <TableCell>{t.active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(t.updated_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" aria-label={`Parts for ${t.system_code}`} onClick={() => setViewing(t)}>
                            <ListTree className="h-3.5 w-3.5" />
                          </Button>
                          {canManage ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t.active ? `Deactivate ${t.system_code}` : `Activate ${t.system_code}`}
                              title={t.active ? "Deactivate (hide from new build requests)" : "Activate"}
                              disabled={setActive.isPending}
                              onClick={() => setActive.mutate({ t, active: !t.active })}
                            >
                              {t.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    {term
                      ? "No matches."
                      : all.length > 0
                        ? "All systems are inactive."
                        : canManage
                          ? "No systems yet. Download the template, fill it in, then import it."
                          : "No systems yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SystemPartsDialog template={viewing} onOpenChange={(o) => !o && setViewing(null)} />
      {canManage ? <SystemImportDialog open={importOpen} onOpenChange={setImportOpen} /> : null}
    </div>
  );
}

function SystemPartsDialog({ template, onOpenChange }: { template: SystemTemplate | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!template} onOpenChange={onOpenChange}>
      {template ? (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{template.system_code}</span>
              <span className="font-normal text-muted-foreground">·</span>
              {template.name}
              {!template.active ? <Badge variant="outline">Inactive</Badge> : null}
            </DialogTitle>
            <DialogDescription>
              {SYSTEM_CATEGORY_LABELS[template.category]} · parts for one unit
              {template.description ? ` · ${template.description}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Part</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead />
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {template.parts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.line_no}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{p.product?.part_number ?? "—"}</span>
                      {p.product ? <> — {p.product.description}</> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatQty(p.qty_per_system)} {p.product?.unit ?? ""}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {p.is_key_part ? <Badge>Key</Badge> : null}
                        {p.product?.is_serialized ? <Badge variant="secondary">Serialized</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.notes ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            To change this list, edit the spreadsheet and import it again. Build requests already made keep their own copy.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
