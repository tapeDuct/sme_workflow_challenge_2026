from __future__ import annotations

from pathlib import Path

import pandas as pd

from modules.ingest import parse_file, normalize_columns, detect_source


def merge_files(file_paths: list[str | Path]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    all_columns: set[str] = set()

    for fpath in file_paths:
        path = Path(fpath)
        df = parse_file(path)
        if df.empty:
            continue
        df = normalize_columns(df)
        frames.append(df)
        all_columns.update(df.columns)

    if not frames:
        return pd.DataFrame()

    result_rows: list[dict] = []
    for df in frames:
        df = df.copy()
        for col in all_columns - set(df.columns):
            df[col] = None
        result_rows.extend(df.to_dict(orient="records"))

    return pd.DataFrame(result_rows, columns=sorted(all_columns))


def group_by_category(df: pd.DataFrame, category_col: str) -> dict[str, pd.DataFrame]:
    groups = {}
    for category, group_df in df.groupby(category_col):
        if pd.notna(category) and str(category).strip():
            groups[str(category).strip()] = group_df.copy()
    return groups
