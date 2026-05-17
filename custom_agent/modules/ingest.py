from __future__ import annotations

import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd

warnings.filterwarnings("ignore", category=pd.errors.PerformanceWarning)


CANONICAL_COLUMNS = [
    "source", "location", "sku", "item_description", "item_category",
    "partner", "quantity", "sales_volume", "revenue", "unit_price",
    "cost_price", "event_type", "event_description", "source_file", "ingested_at",
]

COLUMN_MAP = {
    "Sales outlets": "location",
    "Item description": "item_description",
    "Item Number": "sku",
    "Item category": "item_category",
    "Item supplier (Partner)": "partner",
    "Current Inventory": "quantity",
    "Sales volume": "sales_volume",
    "Revenue": "revenue",
    "Total selling price": "unit_price",
    "Item brand": "item_brand",
    "Company": "company",
}

LOCATION_MAP = {
    "The Social Space (Kreta Ayer)": "Kreta Ayer",
    "The Social Space (Potong Pasir)": "Potong Pasir",
    "KRETA AYER": "Kreta Ayer",
    "POTONG PASIR": "Potong Pasir",
    "ONLINE STORE": "Online",
}

CATEGORY_COLUMNS = ["item_category", "Item category", "partner", "Item supplier (Partner)"]


def detect_source(filename: str) -> str:
    name = filename.lower()
    if "pos" in name:
        return "pos"
    if "online" in name:
        return "online"
    if any(w in name for w in ("corp", "corporate", "bulk")):
        return "corporate"
    if "product" in name or "mix" in name:
        return "product_mix"
    return "unknown"


def parse_file(file_path: str | Path) -> pd.DataFrame:
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix in (".ods", ".xlsx"):
        sheets = pd.read_excel(
            path,
            engine="odf" if suffix == ".ods" else "openpyxl",
            sheet_name=None,
        )
        frames = []
        for sheet_name, sheet_df in sheets.items():
            if sheet_df.empty:
                continue
            sheet_df["_sheet_name"] = sheet_name
            frames.append(sheet_df)
        if not frames:
            return pd.DataFrame()
        result = pd.concat(frames, ignore_index=True)
    elif suffix == ".csv":
        try:
            result = pd.read_csv(path)
        except Exception:
            result = pd.read_csv(path, encoding="latin-1")
    else:
        raise ValueError(f"Unsupported format: {suffix}")

    result["source"] = detect_source(path.name)
    result["source_file"] = str(path)
    result["ingested_at"] = datetime.now(timezone.utc).isoformat()
    return result.copy()


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    for old, new in COLUMN_MAP.items():
        if old in df.columns:
            df = df.rename(columns={old: new})
    return df


def standardize_locations(df: pd.DataFrame) -> pd.DataFrame:
    if "location" not in df.columns:
        return df
    df["location"] = df["location"].astype(str).str.strip()
    for old, new in LOCATION_MAP.items():
        df.loc[df["location"] == old, "location"] = new
    return df


def get_categories(df: pd.DataFrame) -> list[str]:
    for col in CATEGORY_COLUMNS:
        if col in df.columns:
            return sorted(df[col].dropna().unique().tolist())
    return []


def get_partner_column(df: pd.DataFrame) -> str | None:
    for col in CATEGORY_COLUMNS:
        if col in df.columns:
            return col
    return None
