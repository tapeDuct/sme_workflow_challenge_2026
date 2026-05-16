from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from src.ingestion import parse_file, normalize_columns


def merge_sheets(file_paths: list[str | Path], source_labels: list[str] | None = None) -> pd.DataFrame:
    """Row-append multiple CSV/ODS files into a single master DataFrame.

    Columns are unioned across all files — missing columns are filled with NaN.
    Each row is tagged with its source file.
    """
    frames: list[pd.DataFrame] = []
    all_columns: set[str] = set()

    if source_labels and len(source_labels) != len(file_paths):
        source_labels = None

    for i, path in enumerate(file_paths):
        label = source_labels[i] if source_labels else None
        df = parse_file(Path(path), source=label)
        df = normalize_columns(df)
        frames.append(df)
        all_columns.update(df.columns)

    result_rows: list[dict[str, Any]] = []
    for df in frames:
        for col in all_columns:
            if col not in df.columns:
                df[col] = None
        result_rows.extend(df.to_dict(orient="records"))

    result = pd.DataFrame(result_rows, columns=sorted(all_columns))
    return result


def get_unique_categories(df: pd.DataFrame) -> list[str]:
    """Get unique item categories (partners) from the master table."""
    for col in ["item_category", "Item category", "partner"]:
        if col in df.columns:
            return sorted(df[col].dropna().unique().tolist())
    return []


def group_by_category(df: pd.DataFrame, category_col: str = "item_category") -> dict[str, pd.DataFrame]:
    """Split master table into per-category (per-partner) DataFrames."""
    if category_col not in df.columns:
        for alt in ["Item category", "partner", "Item supplier (Partner)"]:
            if alt in df.columns:
                category_col = alt
                break
        else:
            return {}

    groups = {}
    for category, group_df in df.groupby(category_col):
        if pd.notna(category) and str(category).strip():
            groups[str(category).strip()] = group_df.copy()
    return groups


def get_column_union(file_paths: list[str]) -> list[str]:
    """Preview the union of all columns from multiple files without loading data."""
    all_columns: set[str] = set()
    for path in file_paths:
        df = parse_file(Path(path))
        all_columns.update(df.columns)
    return sorted(all_columns)
