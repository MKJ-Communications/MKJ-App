import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Serial-number tracking (frontend layer).
 *
 * Every read here fails soft: if a table or column is missing the UI behaves
 * exactly as it did before serials existed (`useSerialSupport()` returns false
 * and all serial UI hides). That gate is kept even now that the schema is live,
 * so a frontend deploy can never get ahead of the database.
 *
 * Schema (see the …_serial_number_tracking and …_borrow_request_serials
 * migrations; product_id on the two capture tables is trigger-filled, so
 * inserts only ever send the parent id and the serial):
 *   products.is_serialized                      boolean not null default false
 *   packing_slip_item_serials(id, slip_item_id, serial)
 *   shipping_ticket_item_serials(id, ticket_item_id, serial)
 *   borrow_request_serials(id, request_id, serial, returned_at)
 *   v_project_serials(project_id, product_id, serial, status)   -- status: 'in_stock' | 'shipped' | 'in_system'
 *     ('in_system' = used inside a manufactured system; finished units' IDs are listed as serials too)
 *
 * The loose client below predates the generated types and is still what these
 * helpers use: it keeps the dynamic select strings simple and the fail-soft
 * behavior intact.
 */
export const SERIAL_TABLES = {
  slipItemSerials: "packing_slip_item_serials",
  ticketItemSerials: "shipping_ticket_item_serials",
  borrowSerials: "borrow_request_serials",
  projectSerials: "v_project_serials",
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const db = supabase as unknown as LooseClient;

export function normalizeSerial(value: string): string {
  return value.trim();
}

/** Serial slots for a line: one entry per received/shipped unit, blanks allowed. */
export function resizeSerials(values: string[], qty: number): string[] {
  const next = values.slice(0, Math.max(0, qty));
  while (next.length < qty) next.push("");
  return next;
}

export function countFilled(values: string[]): number {
  return values.filter((v) => normalizeSerial(v).length > 0).length;
}

/** Indexes of entries repeated within the same line (case-insensitive). */
export function duplicateIndexes(values: string[]): Set<number> {
  const seen = new Map<string, number>();
  const dups = new Set<number>();
  values.forEach((v, i) => {
    const key = normalizeSerial(v).toLowerCase();
    if (!key) return;
    if (seen.has(key)) {
      dups.add(i);
      dups.add(seen.get(key)!);
    } else {
      seen.set(key, i);
    }
  });
  return dups;
}

async function probeSerialSupport(): Promise<boolean> {
  const { error } = await db.from("products").select("is_serialized").limit(1);
  return !error;
}

/** True once the backend serial schema exists. Cached for the session. */
export function useSerialSupport() {
  return useQuery({
    queryKey: ["serial-support"],
    queryFn: probeSerialSupport,
    staleTime: Infinity,
    retry: false,
  });
}

/** Set of product ids flagged as serialized. Empty when unsupported. */
export function useSerializedProducts(enabled: boolean) {
  return useQuery({
    queryKey: ["serialized-products"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("products").select("id").eq("is_serialized", true);
      if (error) return new Set<string>();
      return new Set<string>(((data ?? []) as { id: string }[]).map((p) => p.id));
    },
  });
}

type SerialRow = { id: string; serial: string };

async function fetchSerialsBy(table: string, fk: string, ids: string[]) {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const { data, error } = await db.from(table).select(`id, ${fk}, serial`).in(fk, ids);
  if (error) return map;
  for (const row of (data ?? []) as (SerialRow & Record<string, string>)[]) {
    const key = row[fk];
    map.set(key, [...(map.get(key) ?? []), row.serial]);
  }
  return map;
}

export function fetchSlipItemSerials(slipItemIds: string[]) {
  return fetchSerialsBy(SERIAL_TABLES.slipItemSerials, "slip_item_id", slipItemIds);
}

export function fetchTicketItemSerials(ticketItemIds: string[]) {
  return fetchSerialsBy(SERIAL_TABLES.ticketItemSerials, "ticket_item_id", ticketItemIds);
}

async function replaceSerials(table: string, fk: string, id: string, serials: string[]) {
  const clean = serials.map(normalizeSerial).filter(Boolean);
  const { error: delErr } = await db.from(table).delete().eq(fk, id);
  if (delErr) throw delErr;
  if (clean.length === 0) return;
  const { error } = await db.from(table).insert(clean.map((serial) => ({ [fk]: id, serial })));
  if (error) throw error;
}

export function saveSlipItemSerials(slipItemId: string, serials: string[]) {
  return replaceSerials(SERIAL_TABLES.slipItemSerials, "slip_item_id", slipItemId, serials);
}

export function saveTicketItemSerials(ticketItemId: string, serials: string[]) {
  return replaceSerials(SERIAL_TABLES.ticketItemSerials, "ticket_item_id", ticketItemId, serials);
}

export type ProjectSerial = { project_id: string; product_id: string; serial: string; status: string | null };

/** Serials currently on hand, optionally narrowed to a project / product. */
export async function fetchProjectSerials(opts: { projectId?: string; productId?: string } = {}) {
  let query = db.from(SERIAL_TABLES.projectSerials).select("project_id, product_id, serial, status");
  if (opts.projectId) query = query.eq("project_id", opts.projectId);
  if (opts.productId) query = query.eq("product_id", opts.productId);
  const { data, error } = await query;
  if (error) return [] as ProjectSerial[];
  return ((data ?? []) as ProjectSerial[]).filter((s) => !s.status || s.status === "in_stock");
}

/** Serials on hand grouped by `${project_id}:${product_id}`. */
export function useInventorySerials(enabled: boolean) {
  return useQuery({
    queryKey: ["inventory-serials"],
    enabled,
    queryFn: async () => {
      const rows = await fetchProjectSerials();
      const map = new Map<string, string[]>();
      for (const r of rows) {
        const key = `${r.project_id}:${r.product_id}`;
        map.set(key, [...(map.get(key) ?? []), r.serial]);
      }
      for (const [, list] of map) list.sort((a, b) => a.localeCompare(b));
      return map;
    },
  });
}

export type BorrowSerial = { serial: string; returned_at: string | null };

/**
 * Units named on a borrow request. Rows with returned_at still set to null
 * are the ones physically sitting at the borrowing project — v_project_serials
 * lists those under that project, not the lender.
 *
 * Written only by decide_borrow_request / return_borrowed_stock (both take an
 * optional _serials array), so there is no save helper here.
 */
export async function fetchBorrowSerials(requestId: string): Promise<BorrowSerial[]> {
  const { data, error } = await db
    .from(SERIAL_TABLES.borrowSerials)
    .select("serial, returned_at")
    .eq("request_id", requestId)
    .order("serial");
  if (error) return [];
  return (data ?? []) as BorrowSerial[];
}

export function useBorrowSerials(requestId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["borrow-serials", requestId],
    enabled: enabled && !!requestId,
    queryFn: () => fetchBorrowSerials(requestId!),
  });
}
