from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


class Normalizer:
    def __init__(self):
        self.corrections: dict[str, dict[str, str]] = {}
        self.log: list[dict[str, Any]] = []

    def load(self, file_path: str | Path) -> int:
        path = Path(file_path)
        if not path.exists():
            return 0

        try:
            df = pd.read_csv(path) if path.suffix == ".csv" else pd.read_excel(path, engine="odf")
            required = {"column", "original_value", "corrected_value"}
            if not required.issubset(set(df.columns)):
                return 0

            count = 0
            for _, row in df.iterrows():
                col = str(row["column"]).strip()
                orig = str(row["original_value"]).strip()
                corrected = str(row["corrected_value"]).strip()
                if validated := (col and orig and corrected):
                    self.corrections.setdefault(col, {})[orig] = corrected
                    count += 1
            return count
        except Exception:
            return 0

    def apply(self, df: pd.DataFrame) -> pd.DataFrame:
        if not self.corrections:
            return df

        df = df.copy()
        for col, replacements in self.corrections.items():
            if col not in df.columns:
                continue
            corrected_col = f"corrected_{col}"
            if corrected_col not in df.columns:
                df[corrected_col] = df[col].astype(str)

            for orig, corrected in replacements.items():
                mask = df[col].astype(str).str.strip() == orig
                count = mask.sum()
                if count > 0:
                    df.loc[mask, corrected_col] = corrected
                    self.log.append({
                        "column": col,
                        "original": orig,
                        "corrected": corrected,
                        "rows_affected": int(count),
                    })

        return df

    def summary(self) -> dict[str, Any]:
        total = sum(item["rows_affected"] for item in self.log)
        return {"total_corrections": len(self.log), "rows_affected": total, "details": self.log}
