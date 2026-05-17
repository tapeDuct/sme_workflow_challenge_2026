from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd

# Canonical column names for internal representation
CANONICAL_COLUMNS = [
    "source",
    "transaction_date",
    "event_type",
    "event_description",
    "location",
    "sku",
    "item_description",
    "quantity",
    "unit_price",
    "cost_price",
    "partner",
    "revenue",
    "source_file",
    "ingested_at",
]


def detect_source(filename: str, df: pd.DataFrame) -> str:
    """Detect data source type from filename or column patterns."""
    name = filename.lower()
    if "pos" in name or "kreta" in name or "potong" in name:
        return "pos"
    if "online" in name:
        return "online"
    if "corp" in name or "corporate" in name or "bulk" in name:
        return "corporate"
    if "product_mix" in name or "product mix" in name:
        return "product_mix"
    return "unknown"


def parse_file(file_path: str | Path, source: Optional[str] = None) -> pd.DataFrame:
    """Parse a CSV or ODS file into a raw DataFrame."""
    file_path = Path(file_path)
    suffix = file_path.suffix.lower()

    if suffix in (".ods", ".xlsx", ".xls"):
        sheets = pd.read_excel(file_path, engine="odf" if suffix == ".ods" else "openpyxl", sheet_name=None)
        for sheet_name, sheet_df in sheets.items():
            if not sheet_df.empty:
                sheet_df["_sheet_name"] = sheet_name
                return _add_metadata(sheet_df, file_path, source)
        return _add_metadata(sheets[list(sheets.keys())[0]], file_path, source)

    if suffix == ".csv":
        try:
            df = pd.read_csv(file_path)
        except Exception:
            df = pd.read_csv(file_path, encoding="latin-1")
        return _add_metadata(df, file_path, source)

    raise ValueError(f"Unsupported file format: {suffix}")


def _add_metadata(df: pd.DataFrame, file_path: Path, source: Optional[str]) -> pd.DataFrame:
    df = df.copy()
    source = source or detect_source(file_path.name, df)
    df["source"] = source
    df["source_file"] = str(file_path)
    df["ingested_at"] = datetime.now(timezone.utc).isoformat()
    return df


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Map source-specific column names to canonical names."""
    canonical_map = {
        "Sales outlets": "location",
        "Item description": "item_description",
        "Item Number": "sku",
        "Item supplier (Partner)": "partner",
        "Current Inventory": "quantity",
        "Sales volume": "sales_volume",
        "Revenue": "revenue",
        "Total selling price": "unit_price",
        "Item category": "item_category",
        "Item brand": "item_brand",
        "Company": "company",
        "Specifications": "specifications",
    }

    for old, new in canonical_map.items():
        if old in df.columns:
            df = df.rename(columns={old: new})

    return df


def standardize_locations(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize location names to canonical values."""
    location_map = {
        "The Social Space (Kreta Ayer)": "Kreta Ayer",
        "The Social Space (Potong Pasir)": "Potong Pasir",
        "KRETA AYER": "Kreta Ayer",
        "POTONG PASIR": "Potong Pasir",
        "ONLINE STORE": "Online",
        "Online": "Online",
    }

    if "location" in df.columns:
        df["location"] = df["location"].str.strip().replace(location_map)

    return df


def standardize_events(df: pd.DataFrame, col_name: str) -> pd.DataFrame:
    """Standardize event descriptions in a column."""
    if col_name not in df.columns:
        return df

    replacements = {
        r"(?i)stock\s*in": "GRN",
        r"(?i)stock\s*out": "Inv Adjustment",
        r"(?i)stock\s*received": "GRN",
        r"(?i)goods\s*received": "GRN",
        r"(?i)location\s*transfer": "Location Transfer",
        r"(?i)transfer\s*out": "Location Transfer",
        r"(?i)transfer\s*in": "Location Transfer",
        r"(?i)inventory\s*adjustment": "Inv Adjustment",
        r"(?i)inv\s*adjust": "Inv Adjustment",
        r"(?i)recon": "Inv Adjustment",
        r"(?i)sale": "Sales",
        r"(?i)corp\s*order": "Location Transfer",
        r"(?i)sample": "Sample",
    }

    for pattern, replacement in replacements.items():
        mask = df[col_name].astype(str).str.match(pattern, na=False)
        df.loc[mask, col_name] = replacement

    return df


def get_partner_mapping(product_mix_df: pd.DataFrame) -> dict[str, str]:
    """Extract SKU → Partner mapping from the product mix report."""
    mapping = {}
    if "sku" in product_mix_df.columns and "partner" in product_mix_df.columns:
        valid = product_mix_df.dropna(subset=["sku", "partner"])
        mapping = dict(zip(valid["sku"].astype(str), valid["partner"].astype(str)))
    return mapping


def get_partner_list(product_mix_df: pd.DataFrame) -> list[str]:
    """Get unique partner names from product mix report."""
    if "partner" in product_mix_df.columns:
        return sorted(product_mix_df["partner"].dropna().unique().tolist())
    return []


def compute_file_hash(file_path: Path) -> str:
    """Compute SHA-256 hash of file for deduplication."""
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()
