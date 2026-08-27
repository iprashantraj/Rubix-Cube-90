# GeM category templates

⚠️ **Blocking — spec §18 items 1 and 2.**

One JSON descriptor per GeM category. `GeMAdapter._load_template` reads
`<gem_category_id>.json`, so adding a category is dropping in a file and never editing the
adapter.

These must be derived from the **real** category Excel downloaded from GeM's Catalogue
Management. Do not invent columns — a plausible-looking sheet that GeM rejects is worse
than no sheet, because the artisan spends three days finding out.

```json
{
  "sheet_name": "Catalog",
  "gem_category_id": "...",
  "columns": [
    { "header": "Product Name", "field": "product_name", "required": true },
    { "header": "HSN Code",     "field": "hsn_code",     "required": true }
  ]
}
```

`field` maps to a key returned by `GeMAdapter.map_attributes`. A `field` with no matching
key silently emits an empty cell, so keep the two in step.
