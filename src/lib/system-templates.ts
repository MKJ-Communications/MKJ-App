import { useQuery } from "@tanstack/react-query";
import readXlsxFile from "read-excel-file/browser";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type SystemCategory = Database["public"]["Enums"]["system_category"];

export const SYSTEM_CATEGORY_LABELS: Record<SystemCategory, string> = {
  cctv_cabinet: "CCTV cabinet",
  data_cabinet: "Data cabinet",
  access_control: "Access control",
  fiber_enclosure: "Fiber enclosure",
  other: "Other",
};

export type SystemTemplatePart = {
  id: string;
  line_no: number;
  product_id: string;
  qty_per_system: number;
  is_key_part: boolean;
  notes: string | null;
  product: { part_number: string; description: string; unit: string; is_serialized: boolean } | null;
};

export type SystemTemplate = {
  id: string;
  system_code: string;
  name: string;
  category: SystemCategory;
  description: string | null;
  active: boolean;
  updated_at: string;
  parts: SystemTemplatePart[];
};

/** Every system template with its parts list (RLS: any signed-in role can read them). */
export function useSystemTemplates() {
  return useQuery({
    queryKey: ["system-templates"],
    queryFn: async (): Promise<SystemTemplate[]> => {
      const { data, error } = await supabase
        .from("system_templates")
        .select(
          "id, system_code, name, category, description, active, updated_at, system_template_parts(id, line_no, product_id, qty_per_system, is_key_part, notes, products:product_id(part_number, description, unit, is_serialized))",
        )
        .order("system_code");
      if (error) throw error;
      return (data ?? []).map(({ system_template_parts, ...t }) => ({
        ...t,
        parts: (system_template_parts ?? [])
          .map(({ products, ...p }) => ({ ...p, qty_per_system: Number(p.qty_per_system), product: products ?? null }))
          .sort((a, b) => a.line_no - b.line_no),
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Spreadsheet import. The file is only read here; every rule is checked by
// import_system_templates in the database (dry run first, then for real), so
// the preview the user sees is exactly what the server will do.
// ---------------------------------------------------------------------------

export const SYSTEMS_TEMPLATE_URL = "/manufacturing-systems-template.xlsx";

const SYSTEMS_TAB = "1 Systems";
const PARTS_TAB = "2 System Parts";

export type ImportSystemRow = {
  row_no: number;
  system_code: string;
  name: string;
  category: string;
  description: string;
};

export type ImportPartRow = {
  row_no: number;
  system_code: string;
  part_number: string;
  // Anything that isn't a clean number / TRUE / FALSE is passed through as
  // text so the database can name the exact row in its error.
  qty_per_system: number | string | null;
  is_key_part: boolean | string | null;
  description: string;
  unit: string;
  is_serialized: boolean | string | null;
  notes: string;
};

export type SystemsImportPayload = { systems: ImportSystemRow[]; parts: ImportPartRow[] };

export type SystemsImportResult = {
  imported: boolean;
  errors: string[];
  systems: {
    row_no: number | null;
    system_code: string;
    name: string;
    category: string;
    action: "create" | "replace";
    part_count: number;
    key_part_count: number;
  }[];
  new_products: { part_number: string; description: string; unit: string; is_serialized: boolean }[];
};

/** A problem with the file itself (wrong file, missing tab or column), found before anything is sent. */
export class SpreadsheetFormatError extends Error {}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function numberOrText(v: unknown): number | string | null {
  if (typeof v === "number") return v;
  const s = text(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

function yesNo(v: unknown): boolean | string | null {
  if (typeof v === "boolean") return v;
  const s = text(v);
  if (s === "") return null;
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  return s;
}

type TabRow = { rowNo: number; get: (column: string) => unknown };

function readTab(sheets: { sheet: string; data: unknown[][] }[], name: string, required: string[]): TabRow[] {
  const sheet = sheets.find((s) => s.sheet.trim().toLowerCase() === name.toLowerCase());
  if (!sheet) {
    throw new SpreadsheetFormatError(`This file has no "${name}" tab. Start from the systems template.`);
  }
  const [header = [], ...body] = sheet.data;
  const columns = new Map(header.map((h, i) => [text(h).toLowerCase(), i]));
  const missing = required.filter((c) => !columns.has(c));
  if (missing.length > 0) {
    throw new SpreadsheetFormatError(
      `Tab "${name}" is missing the ${missing.length === 1 ? "column" : "columns"} ${missing.join(", ")}. Keep row 1 exactly as in the template.`,
    );
  }
  return body
    .map((cells, i) => ({
      rowNo: i + 2, // row 1 is the header
      cells,
      get: (column: string) => {
        const idx = columns.get(column);
        return idx === undefined ? null : cells[idx] ?? null;
      },
    }))
    .filter((r) => r.cells.some((c) => text(c) !== ""));
}

export async function readSystemsSpreadsheet(file: File): Promise<SystemsImportPayload> {
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = (await readXlsxFile(file)) as { sheet: string; data: unknown[][] }[];
  } catch {
    throw new SpreadsheetFormatError("This file couldn't be read as an Excel spreadsheet (.xlsx).");
  }

  const systems = readTab(sheets, SYSTEMS_TAB, ["system_code", "name", "category"]).map((r) => ({
    row_no: r.rowNo,
    system_code: text(r.get("system_code")),
    name: text(r.get("name")),
    category: text(r.get("category")),
    description: text(r.get("description")),
  }));
  const parts = readTab(sheets, PARTS_TAB, ["system_code", "part_number", "qty_per_system"]).map((r) => ({
    row_no: r.rowNo,
    system_code: text(r.get("system_code")),
    part_number: text(r.get("part_number")),
    qty_per_system: numberOrText(r.get("qty_per_system")),
    is_key_part: yesNo(r.get("is_key_part")),
    description: text(r.get("description")),
    unit: text(r.get("unit")),
    is_serialized: yesNo(r.get("is_serialized")),
    notes: text(r.get("notes")),
  }));

  if (systems.length === 0) {
    throw new SpreadsheetFormatError(`Tab "${SYSTEMS_TAB}" has no rows to import.`);
  }
  return { systems, parts };
}

/** dryRun: validate and preview only. Otherwise imports everything or nothing. */
export async function importSystems(payload: SystemsImportPayload, dryRun: boolean): Promise<SystemsImportResult> {
  const { data, error } = await supabase.rpc("import_system_templates", {
    _systems: payload.systems as unknown as Json,
    _parts: payload.parts as unknown as Json,
    _dry_run: dryRun,
  });
  if (error) throw error;
  return data as unknown as SystemsImportResult;
}

export function formatQty(q: number): string {
  return Number(q).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
