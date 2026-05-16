from __future__ import annotations

import json
from typing import Any

import asyncio

from src.ai import ai


class AIReviewer:
    """Scans a master table for issues. Auto-fixes what it can, flags the rest."""

    def __init__(self):
        self.pass_name = "AI Data Review"

    async def review_cell(
        self,
        column_name: str,
        current_value: str,
        row_context: dict[str, Any],
    ) -> dict[str, Any]:
        """Review a single cell. Returns {action, new_value, issue, confidence, context}."""
        system = (
            "You are a data quality reviewer for a consignment reporting system. "
            "Your job is to review individual cell values and decide if they need correction. "
            "Categories (item_category) represent consignment partners. "
            "The data includes: Sales outlets (Kreta Ayer, Potong Pasir, Online), "
            "Item descriptions, SKUs, quantities, prices, revenue, and partner names.\n\n"
            "Respond with JSON: {\n"
            '  "action": "fix" | "flag" | "ok",\n'
            '  "new_value": "corrected value if action is fix, else null",\n'
            '  "issue": "description of the issue if any",\n'
            '  "confidence": 0.0 to 1.0,\n'
            '  "context": "explanation for the reviewer if flagged"\n'
            "}"
        )

        user = (
            f"Column: {column_name}\n"
            f"Current value: {current_value}\n"
            f"Row data: {json.dumps(row_context, default=str)[:800]}\n\n"
            f"Check for: typos, inconsistent naming, outlier values, "
            f"missing partner attribution, suspicious price/revenue ratios, "
            f"location mismatches, or any data quality issue."
        )

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

        output = await ai.chat(messages)

        try:
            result = json.loads(output)
            return {
                "action": result.get("action", "ok"),
                "new_value": result.get("new_value"),
                "issue": result.get("issue", ""),
                "confidence": float(result.get("confidence", 0.8)),
                "context": result.get("context", ""),
            }
        except (json.JSONDecodeError, ValueError):
            return {
                "action": "ok",
                "new_value": None,
                "issue": "",
                "confidence": 1.0,
                "context": "",
            }

    async def review_row(
        self,
        row_data: dict[str, Any],
        review_columns: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Review an entire row. Returns list of cell-level findings."""
        columns_to_check = review_columns or [
            "item_category", "partner", "item_description",
            "location", "quantity", "unit_price", "revenue", "sku",
        ]

        cols_present = [c for c in columns_to_check if c in row_data]

        tasks = []
        for col in cols_present:
            value = str(row_data.get(col, ""))
            if not value or value in ("nan", "None", "", "NaN", "-"):
                continue
            tasks.append(self.review_cell(col, value, row_data))

        results = await asyncio.gather(*tasks)
        return [r for r in results if r["action"] != "ok"]

    async def review_batch(
        self,
        rows: list[dict[str, Any]],
        review_columns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Review a batch of rows. Returns findings and auto-fixable corrections."""
        all_findings = []
        auto_fixes = []
        flags = []

        for i, row in enumerate(rows):
            findings = await self.review_row(row, review_columns)
            for finding in findings:
                finding["row_index"] = i
                if finding["action"] == "fix" and finding["confidence"] >= 0.85:
                    auto_fixes.append(finding)
                elif finding["action"] == "flag":
                    flags.append(finding)
                all_findings.append(finding)

        return {
            "total_checked": len(rows),
            "auto_fixes": auto_fixes,
            "flags": flags,
            "all_findings": all_findings,
            "issues_found": len(flags),
            "auto_corrected": len(auto_fixes),
        }

    def classify_finding(
        self,
        column_name: str,
        value: str,
        row_context: dict[str, Any],
    ) -> tuple[str, str | None, str]:
        """Quick rule-based classification for common patterns (no API call)."""
        value_str = str(value).strip().lower()

        if not value_str or value_str in ("nan", "none", "-", ""):
            return "flag", None, f"Empty value in '{column_name}' column"

        if column_name in ("item_category", "partner"):
            if value_str in ("无", "nothing", "others", "-", "hidden items"):
                return "flag", None, f"'{column_name}' is '{value}' — needs proper partner assignment"
            if len(value_str) < 3:
                return "flag", None, f"'{column_name}' is too short: '{value}'"

        if column_name in ("revenue", "unit_price", "Total selling price"):
            try:
                num = float(value_str)
                if num < 0:
                    return "flag", None, f"Negative {column_name}: {value}"
                if num == 0:
                    return "flag", None, f"Zero {column_name}: {value}"
            except (ValueError, TypeError):
                return "flag", None, f"Non-numeric {column_name}: {value}"

        if column_name in ("quantity", "Sales volume", "Current Inventory"):
            try:
                num = float(value_str)
                if num < 0:
                    return "fix", f"{abs(num)}", f"Negative quantity corrected: {value} → {abs(num)}"
            except (ValueError, TypeError):
                return "flag", None, f"Non-numeric quantity: {value}"

        return "ok", None, ""


reviewer = AIReviewer()
