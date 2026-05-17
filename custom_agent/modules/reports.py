from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pandas as pd


OUTPUT_DIR = "output"


def ensure_output_dir():
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)


def safe_filename(name: str) -> str:
    return str(name).replace("/", "_").replace(" ", "_").replace("'", "")[:60]


def generate_csv_report(
    partner_data: pd.DataFrame,
    partner_name: str,
    location_col: str | None,
    sku_col: str | None,
    desc_col: str | None,
    qty_col: str | None,
    rev_col: str | None,
    price_col: str | None,
) -> dict[str, Any]:
    filename = f"{safe_filename(partner_name)}.csv"
    filepath = Path(OUTPUT_DIR) / filename

    headers = ["Location", "SKU", "Description", "Quantity", "Revenue", "Unit Price"]
    rows = []

    for _, row in partner_data.iterrows():
        rows.append([
            str(row.get(location_col or "location", "")),
            str(row.get(sku_col or "sku", "")),
            str(row.get(desc_col or "item_description", "")),
            row.get(qty_col or "quantity", "") if qty_col and pd.notna(row.get(qty_col, "")) else "",
            row.get(rev_col or "revenue", "") if rev_col and pd.notna(row.get(rev_col, "")) else "",
            row.get(price_col or "unit_price", "") if price_col and pd.notna(row.get(price_col, "")) else "",
        ])

    with open(filepath, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    qty_sum = partner_data[qty_col].sum() if qty_col and qty_col in partner_data.columns and pd.api.types.is_numeric_dtype(partner_data[qty_col]) else 0
    rev_sum = partner_data[rev_col].sum() if rev_col and rev_col in partner_data.columns and pd.api.types.is_numeric_dtype(partner_data[rev_col]) else 0

    return {
        "partner": partner_name,
        "file": filepath,
        "rows": len(rows),
        "total_quantity": float(qty_sum),
        "total_revenue": float(rev_sum),
    }


def generate_all(
    master: pd.DataFrame,
    category_col: str,
    location_col: str | None = None,
    sku_col: str | None = None,
    desc_col: str | None = None,
    qty_col: str | None = None,
    rev_col: str | None = None,
    price_col: str | None = None,
) -> list[dict[str, Any]]:
    ensure_output_dir()

    results = []
    for category, group_df in master.groupby(category_col):
        if pd.isna(category) or str(category).strip() in ("", "nan", "None"):
            continue

        result = generate_csv_report(
            group_df, str(category).strip(),
            location_col, sku_col, desc_col, qty_col, rev_col, price_col,
        )
        results.append(result)

    return results
