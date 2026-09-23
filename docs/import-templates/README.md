# Warehouse import templates — products, suppliers & pricing

> **Superseded for the initial data load.** The go-live import now uses the
> single workbook at `public/bulk-upload-template.xlsx` (the file the app's
> Bulk Upload page serves), which covers **projects** and **opening inventory**
> as well as the three sheets below. Two deliberate differences there:
> `is_serialized` is omitted — everything is imported non-serialized, because
> serials can only enter through receiving — and inventory has its own hard
> rules, spelled out on that workbook's Instructions tab.
>
> These CSVs remain accurate for topping up products, suppliers and pricing
> later on.

Three CSV files in this folder. Open them in Excel, keep the header row exactly
as-is, replace the example rows with real data, and save as CSV.

Fill them in this order — **suppliers → products → supplier-prices** — because
the prices file refers to the other two by name.

| File | One row per | Fill in |
|---|---|---|
| `suppliers.csv` | vendor | only vendors not already in the app |
| `products.csv` | part | only parts not already in the app |
| `supplier-prices.csv` | **part + vendor combination** | everything you have a price for |

`supplier-prices.csv` is the important one. The other two exist only to create
records that the price rows can point at.

---

## Rules that apply to every file

- **Keep the header row.** Column order doesn't matter; spelling does.
- **Leave a cell blank if you don't know it.** Don't type `N/A`, `-`, `none`,
  or `0` to mean "unknown" — blank and zero are treated differently.
- **Numbers only in number columns.** `214.50`, never `$214.50`, `214,50`, or
  `214.50 ea`. No thousands separators.
- **TRUE / FALSE** in the yes-no columns, not `Y`, `1`, or `x`.
- **One row per thing.** Don't repeat a part number across several rows in
  `products.csv`, and don't repeat a part+vendor pair in `supplier-prices.csv`.
- If a cell contains a comma (an address, a note), Excel wraps it in quotes
  automatically. That's fine — leave it.

---

## `suppliers.csv`

| Column | Required | Notes |
|---|---|---|
| `name` | **yes** | The vendor's name. **Spell it identically everywhere it appears in `supplier-prices.csv`** — this is what links the two files. |
| `contact_name` | no | Your rep. |
| `phone` | no | Any format; it gets normalized on import. |
| `email` | no | |
| `address` | no | Whole address in one cell. |

Only list vendors that aren't already in the app's Suppliers page. If a vendor
is already there, skip it here and just use its **exact existing name** in the
prices file.

> **Watch for near-duplicates.** `Graybar`, `Graybar Electric`, and `GRAYBAR
> INC` are three different vendors as far as the import is concerned. Pick one
> spelling per vendor and stick to it.

---

## `products.csv`

| Column | Required | Notes |
|---|---|---|
| `part_number` | **yes** | Must be unique, and must match the app's part number **exactly** if the part already exists. This is the link to the prices file. |
| `description` | **yes** | |
| `unit` | no | How you *stock* it: `ea`, `box`, `ft`, `case`. Defaults to `ea`. |
| `reorder_point` | no | Whole number. Defaults to `0`. |
| `is_serialized` | no | `TRUE` if each unit has a serial number to track. Defaults to `FALSE`. |

Only list parts that aren't already in the app's Products page.

---

## `supplier-prices.csv` — the main file

One row for **each price you have**: the same part bought from three vendors is
three rows.

| Column | Required | Notes |
|---|---|---|
| `part_number` | **yes** | Must match `products.csv` or an existing app part, exactly. |
| `supplier_name` | see below | Must match `suppliers.csv` or an existing supplier, exactly. |
| `source_label` | see below | For Amazon / eBay / anywhere without a real vendor record. |
| `supplier_sku` | no | Their part number, ASIN, or listing ID — whatever you'd search to reorder. |
| `unit_cost` | **yes** | What **you pay**, not what you charge. Number only. |
| `unit` | no | What that cost buys: `ea`, `box`, `case`. Defaults to `ea`. |
| `is_preferred` | no | `TRUE` for the vendor you'd normally buy this part from. |
| `notes` | no | Lead time, minimum order, anything worth remembering. |

### supplier_name vs source_label

Every row needs **one of the two, never both**:

- Bought from a real vendor you cut POs to → fill **`supplier_name`**, leave
  `source_label` blank.
- Bought off Amazon, eBay, or a one-off retail source → leave `supplier_name`
  blank and put the marketplace in **`source_label`**.

```
part_number,supplier_name,source_label,...
WV-S35302-F2L,Anixter,,...          ← real vendor
CBL-CAT6-1000,,Amazon,...           ← marketplace
```

### `unit_cost` is per `unit`, not per piece

If a vendor sells CAT6 in 1000ft boxes at $168.99 a box, that's
`unit_cost = 168.99` with `unit = box` — not the price per foot. Enter the
number the way it appears on the invoice.

### `is_preferred`

Mark **at most one `TRUE` per part number**, across the whole file — the vendor
you'd reach for by default. It's what the Products page shows in the Cost
column. If you mark none, the app shows the cheapest price instead, so leaving
the column entirely blank is a perfectly fine way to start.

---

## What happens on import

- Rows are matched on `part_number` and `supplier_name`. **Nothing is created
  by guessing** — a price row whose part number or vendor doesn't match is
  skipped and listed in an unmatched-rows report for you to fix and re-run.
- Re-running with a corrected file is safe. An existing part+vendor price is
  **updated in place**, not duplicated, and its previous cost is kept in the
  price history so you can see what changed and when.
- Only the price actually changing moves the "Updated" date. Fixing a typo in a
  note or SKU doesn't.

## Who can see this

Costs are visible to **admins, warehouse managers, and managers**. Engineers
can see the products list but the cost columns read blank for them.
