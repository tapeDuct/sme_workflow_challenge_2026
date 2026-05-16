from __future__ import annotations

from typing import Any

import pandas as pd

# Report section names per the challenge brief
REPORT_SECTIONS = [
    "Opening Stock Balance",
    "Sales",
    "Goods Received (GRN)",
    "Inventory Adjustment",
    "Location Transfer",
    "Closing Stock Balance",
    "Revenue Due to Vendor",
]


def generate_legacy_report(
    partner_data: pd.DataFrame,
    partner_name: str,
) -> tuple[list[str], list[list[Any]]]:
    """Generate the legacy (Optimatic-style) report for a single partner.

    Groups by SKU and location, produces a SKU × timeline stock movement matrix.
    Returns (headers, rows).
    """
    if partner_data.empty:
        return [], []

    location_col = _find_col(partner_data, ["location", "Sales outlets"])
    sku_col = _find_col(partner_data, ["sku", "Item Number"])
    desc_col = _find_col(partner_data, ["item_description", "Item description"])
    price_col = _find_col(partner_data, ["unit_price", "Retail Price", "Total selling price"])
    cost_col = _find_col(partner_data, ["cost_price", "Cost Price"])
    qty_col = _find_col(partner_data, ["quantity", "Current Inventory", "Sales volume"])
    rev_col = _find_col(partner_data, ["revenue", "Revenue"])

    headers = [
        "Location", "SKU", "Description", "Retail Price", "Cost Price",
        "Current Inventory", "Sales Volume", "Revenue", "Source File",
    ]
    rows = []

    for _, row in partner_data.iterrows():
        row_data = []
        for h in headers:
            mapped = {
                "Location": location_col,
                "SKU": sku_col,
                "Description": desc_col,
                "Retail Price": price_col,
                "Cost Price": cost_col,
                "Current Inventory": qty_col,
                "Sales Volume": qty_col,
                "Revenue": rev_col,
                "Source File": "source_file",
            }.get(h)
            val = row.get(mapped, "") if mapped else ""
            row_data.append(str(val) if pd.notna(val) else "")
        rows.append(row_data)

    return headers, rows


def generate_recommended_report(
    partner_data: pd.DataFrame,
    partner_name: str,
) -> tuple[list[str], list[list[Any]]]:
    """Generate the recommended (normalized row-based) report.

    Each row = one transaction with: Date, Event Type, Location, SKU, Description, Quantity, Price, Revenue.
    """
    location_col = _find_col(partner_data, ["location", "Sales outlets"])
    sku_col = _find_col(partner_data, ["sku", "Item Number"])
    desc_col = _find_col(partner_data, ["item_description", "Item description"])
    price_col = _find_col(partner_data, ["unit_price", "Total selling price"])
    qty_col = _find_col(partner_data, ["quantity", "Sales volume", "Current Inventory"])
    rev_col = _find_col(partner_data, ["revenue", "Revenue"])
    date_col = _find_col(partner_data, ["transaction_date", "Date", "ingested_at"])

    headers = [
        "Partner", "Transaction Date", "Event Type", "Location",
        "SKU", "Description", "Quantity", "Unit Price", "Revenue", "Source",
    ]
    rows = []

    for _, row in partner_data.iterrows():
        row_data = [
            partner_name,
            str(row.get(date_col, "")) if date_col and pd.notna(row.get(date_col, "")) else "",
            "Sales" if "sales" in str(row.get("source", "")).lower() else "Mixed",
            str(row.get(location_col, "")) if location_col else "",
            str(row.get(sku_col, "")) if sku_col else "",
            str(row.get(desc_col, "")) if desc_col else "",
            row.get(qty_col, 0) if qty_col else 0,
            row.get(price_col, 0) if price_col else 0,
            row.get(rev_col, 0) if rev_col else 0,
            str(row.get("source", "")),
        ]
        rows.append(row_data)

    return headers, rows


def get_partner_summary(partner_data: pd.DataFrame, partner_name: str) -> dict[str, Any]:
    """Generate summary stats for a partner."""
    qty_col = _find_col(partner_data, ["quantity", "Sales volume", "Current Inventory"])
    rev_col = _find_col(partner_data, ["revenue", "Revenue"])
    location_col = _find_col(partner_data, ["location", "Sales outlets"])

    summary = {
        "partner": partner_name,
        "total_rows": len(partner_data),
        "unique_skus": partner_data[_find_col(partner_data, ["sku", "Item Number"])].nunique() if _find_col(partner_data, ["sku", "Item Number"]) else 0,
    }

    if qty_col:
        summary["total_quantity"] = float(partner_data[qty_col].sum()) if pd.api.types.is_numeric_dtype(partner_data[qty_col]) else 0
    if rev_col:
        summary["total_revenue"] = float(partner_data[rev_col].sum()) if pd.api.types.is_numeric_dtype(partner_data[rev_col]) else 0

    if location_col:
        locations = partner_data[location_col].dropna().unique().tolist()
        summary["locations"] = [str(loc) for loc in locations]

    return summary


def _find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    """Find the first matching column from a list of candidate names."""
    for c in candidates:
        if c in df.columns:
            return c
    return None
