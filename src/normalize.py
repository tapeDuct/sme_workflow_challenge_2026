from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd


class Normalizer:
    """Applies corrections and validation to data without removing original columns."""

    def __init__(self):
        self.corrections_log: list[dict[str, Any]] = []
        self.corrections_cache: dict[str, dict[str, str]] = {}

    def load_corrections(self, file_path: str | Path) -> dict[str, dict[str, str]]:
        """Load corrections reference from a CSV/ODS file."""
        path = Path(file_path)
        if not path.exists():
            return {}

        try:
            if path.suffix.lower() == ".csv":
                df = pd.read_csv(path)
            else:
                df = pd.read_excel(path, engine="odf")

            corrections: dict[str, dict[str, str]] = defaultdict(dict)
            required = {"column", "original_value", "corrected_value"}
            if not required.issubset(set(df.columns)):
                return {}

            for _, row in df.iterrows():
                col = str(row["column"]).strip()
                orig = str(row["original_value"]).strip()
                corrected = str(row["corrected_value"]).strip()
                corrections[col][orig] = corrected

            self.corrections_cache = dict(corrections)
            return self.corrections_cache
        except Exception:
            return {}

    def apply_global_corrections(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply known corrections to all matching cells."""
        if not self.corrections_cache:
            return df

        df = df.copy()
        for col, replacements in self.corrections_cache.items():
            if col in df.columns:
                for orig, corrected in replacements.items():
                    mask = df[col].astype(str).str.strip() == orig
                    count = mask.sum()
                    if count > 0:
                        corrected_col = f"corrected_{col}"
                        if corrected_col not in df.columns:
                            df[corrected_col] = df[col].astype(str)
                        df.loc[mask, corrected_col] = corrected
                        self.corrections_log.append({
                            "column": col,
                            "original": orig,
                            "corrected": corrected,
                            "rows_affected": int(count),
                        })
        return df

    def add_correction_columns(self, df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
        """Add corrected_* columns alongside originals."""
        df = df.copy()
        for col in columns:
            if col in df.columns:
                corrected_col = f"corrected_{col}"
                if corrected_col not in df.columns:
                    df[corrected_col] = df[col]
        return df

    def validate_required_columns(self, df: pd.DataFrame, required: list[str]) -> tuple[bool, list[str]]:
        """Check that required columns are present."""
        missing = [c for c in required if c not in df.columns]
        return len(missing) == 0, missing

    def get_corrections_summary(self) -> dict[str, Any]:
        """Return summary of applied corrections."""
        total = sum(item["rows_affected"] for item in self.corrections_log)
        return {
            "total_corrections": len(self.corrections_log),
            "total_rows_affected": total,
            "details": self.corrections_log,
        }

    def reset(self):
        """Clear corrections log and cache."""
        self.corrections_log = []
        self.corrections_cache = {}


normalizer = Normalizer()
