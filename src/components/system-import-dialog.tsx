import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SYSTEM_CATEGORY_LABELS,
  SYSTEMS_TEMPLATE_URL,
  importSystems,
  readSystemsSpreadsheet,
  type SystemCategory,
  type SystemsImportPayload,
  type SystemsImportResult,
} from "@/lib/system-templates";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pick the filled-in template, preview what the database would do, then import it (all or nothing). */
export function SystemImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [payload, setPayload] = useState<SystemsImportPayload | null>(null);
  const [preview, setPreview] = useState<SystemsImportResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFileName(null);
    setPayload(null);
    setPreview(null);
    setProblem(null);
  }, [open]);

  const check = useMutation({
    mutationFn: async (file: File) => {
      const p = await readSystemsSpreadsheet(file);
      return { p, result: await importSystems(p, true) };
    },
    onMutate: () => {
      setPayload(null);
      setPreview(null);
      setProblem(null);
    },
    onSuccess: ({ p, result }) => {
      setPayload(p);
      setPreview(result);
    },
    onError: (e: Error) => setProblem(e.message),
  });

  const run = useMutation({
    mutationFn: async () => importSystems(payload!, false),
    onSuccess: (result) => {
      toast.success(`Imported ${plural(result.systems.length, "system")}`);
      qc.invalidateQueries({ queryKey: ["system-templates"] });
      qc.invalidateQueries({ queryKey: ["products-with-cost"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // choosing the same file again (after fixing it) still triggers a check
    if (!file) return;
    setFileName(file.name);
    check.mutate(file);
  }

  const errors = preview?.errors ?? [];
  const ready = !!preview && errors.length === 0 && !check.isPending;
  const newSystems = preview?.systems.filter((s) => s.action === "create").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import systems</DialogTitle>
          <DialogDescription>
            Choose the filled-in systems template. You'll see exactly what will change before anything is saved.
          </DialogDescription>
        </DialogHeader>

        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={onFileChosen} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={() => inputRef.current?.click()} disabled={check.isPending || run.isPending}>
            <Upload className="mr-2 h-4 w-4" />
            {fileName ? "Choose another file" : "Choose file"}
          </Button>
          {fileName ? (
            <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{fileName}</span>
            </div>
          ) : (
            <Button variant="link" className="h-auto justify-start px-0" asChild>
              <a href={SYSTEMS_TEMPLATE_URL} download="mkj-ops-manufacturing-systems-template.xlsx">
                <Download className="mr-1 h-4 w-4" /> Download the template
              </a>
            </Button>
          )}
        </div>

        {check.isPending ? <p className="text-sm text-muted-foreground">Checking the file…</p> : null}

        {problem ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Can't import this file</AlertTitle>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}

        {errors.length > 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{plural(errors.length, "problem")} to fix. Nothing was imported.</AlertTitle>
            <AlertDescription>
              <p className="mb-2">Fix these in the spreadsheet, save it, then choose the file again.</p>
              <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {preview && preview.systems.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Systems in this file</h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Parts</TableHead>
                    <TableHead>What happens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.systems.map((s) => (
                    <TableRow key={`${s.row_no}-${s.system_code}`}>
                      <TableCell className="font-mono">{s.system_code}</TableCell>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{SYSTEM_CATEGORY_LABELS[s.category as SystemCategory] ?? s.category}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.part_count}
                        {s.key_part_count > 0 ? <span className="text-xs text-muted-foreground"> · {s.key_part_count} key</span> : null}
                      </TableCell>
                      <TableCell>
                        {s.action === "create" ? <Badge>New system</Badge> : <Badge variant="secondary">Replaces its parts list</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {newSystems > 0 ? (
              <p className="text-xs text-muted-foreground">
                Each new system is also added to Products, with its code as the part number, so finished units can be
                stocked and shipped.
              </p>
            ) : null}
          </div>
        ) : null}

        {preview && preview.new_products.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{plural(preview.new_products.length, "new part")} will be added to Products</h3>
            <div className="max-h-56 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Serials</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.new_products.map((p) => (
                    <TableRow key={p.part_number}>
                      <TableCell className="font-mono">{p.part_number}</TableCell>
                      <TableCell>{p.description}</TableCell>
                      <TableCell>{p.unit}</TableCell>
                      <TableCell>{p.is_serialized ? <Badge variant="secondary">Serialized</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => run.mutate()} disabled={!ready || run.isPending}>
            {run.isPending ? "Importing…" : preview ? `Import ${plural(preview.systems.length, "system")}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
