// Builds the Schedule of Values CSV the warehouse imports into Procore when
// it enters a PO there. Procore's commitment SOV import expects exactly the
// columns in SOV_HEADER; UOM must be "ea" and Subtotal Override blank, or
// the import is refused.
//
// Only the writer step of the original spec lives here. PO lines are already
// structured (typed in by the warehouse), so nothing parses vendor quotes.

export const SOV_HEADER = ["Cost Code", "Cost Type", "Description", "Quantity", "UOM", "Unit Price", "Subtotal Override"] as const;

export const DEFAULT_SOV_COST_CODE = "01-91-01";
export const DEFAULT_SOV_COST_TYPE = "M"; // Material

export type SovSourceLine = {
  id: string;
  line_no: number;
  description: string;
  qty: number;
  unit: string | null;
  unit_cost: number;
  part_number?: string | null;
};

export type SovRow = {
  id: string;
  line_no: number;
  costCode: string;
  costType: string;
  description: string;
  qty: number;
  unitPrice: number; // rounded to cents
  warnings: string[];
};

/**
 * `<PART NUMBER> - <DESCRIPTION>` in caps, close to the spec's
 * `MANUFACTURER MODEL - DESCRIPTION` (products have no manufacturer field).
 * The part number is only added when the line is linked to a product and
 * the description doesn't already mention it. Commas followed by a space are
 * dropped (the spec prefers no commas); any that remain, like `1,000`, are
 * quoted by csvField.
 */
export function sovDescription(description: string, partNumber?: string | null): string {
  let d = description;
  const pn = partNumber?.trim();
  if (pn && !d.toUpperCase().includes(pn.toUpperCase())) d = `${pn} - ${d}`;
  return d
    .replace(/[™®©]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/,\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const cents = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildSovRows(
  lines: SovSourceLine[],
  costCode: string,
  costType: string,
  overrides: Record<string, { costCode?: string; costType?: string }> = {},
): SovRow[] {
  return lines.map((l) => {
    const qty = Number(l.qty);
    const rawPrice = Number(l.unit_cost);
    const unitPrice = cents(rawPrice);
    const o = overrides[l.id] ?? {};
    const row: SovRow = {
      id: l.id,
      line_no: l.line_no,
      costCode: (o.costCode ?? costCode).trim(),
      costType: (o.costType ?? costType).trim(),
      description: sovDescription(l.description, l.part_number),
      qty,
      unitPrice,
      warnings: [],
    };
    const unit = (l.unit ?? "").trim();
    if (unit && unit.toLowerCase() !== "ea") {
      row.warnings.push(`Unit is ${unit}; written as ea (qty and price kept per ${unit})`);
    }
    if (!row.description) row.warnings.push("Description is blank");
    if (!(qty > 0)) row.warnings.push("Quantity is 0");
    if (!(unitPrice > 0)) row.warnings.push("Unit price is 0.00");
    if (Math.abs(rawPrice - unitPrice) > 1e-9) row.warnings.push(`Unit cost ${rawPrice} rounded to ${unitPrice.toFixed(2)}`);
    if (!row.costCode) row.warnings.push("Cost code is blank");
    if (!row.costType) row.warnings.push("Cost type is blank");
    return row;
  });
}

/**
 * Compares the SOV total with the PO's merchandise subtotal (lines only, no
 * freight). They only differ when a unit cost has more than two decimals.
 */
export function sovTotals(lines: SovSourceLine[], rows: SovRow[]) {
  const sovTotal = cents(rows.reduce((s, r) => s + r.qty * r.unitPrice, 0));
  const poSubtotal = cents(lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0));
  return { sovTotal, poSubtotal, mismatch: Math.abs(sovTotal - poSubtotal) >= 0.005 };
}

/** RFC 4180 quoting: wrap fields containing a comma, quote or line break, and double inner quotes. */
function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function sovCsv(rows: SovRow[]): string {
  const out = [SOV_HEADER.join(",")];
  for (const r of rows) {
    out.push([r.costCode, r.costType, r.description, String(r.qty), "ea", r.unitPrice.toFixed(2), ""].map(csvField).join(","));
  }
  return out.join("\r\n") + "\r\n";
}

/** PO_SOV_<po number>.csv — the browser adds " (1)" if the name is already in Downloads. */
export function sovFileName(poNumber: string): string {
  return `PO_SOV_${poNumber.replace(/[^A-Za-z0-9_-]+/g, "_")}.csv`;
}

/** UTF-8, no BOM, as the importer expects. */
export function downloadSovCsv(rows: SovRow[], poNumber: string): void {
  const blob = new Blob([sovCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = sovFileName(poNumber);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
