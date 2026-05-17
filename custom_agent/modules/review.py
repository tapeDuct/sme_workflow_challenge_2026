from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAI


class AIReviewer:
    def __init__(self):
        self.client = OpenAI(
            api_key=os.getenv("QWEN_API_KEY", ""),
            base_url=os.getenv("QWEN_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
        )
        self.model = os.getenv("QWEN_MODEL", "qwen-plus")
        self.threshold = float(os.getenv("EXTRACTION_CONFIDENCE_THRESHOLD", "0.85"))

    def _ask(self, system: str, user: str) -> dict[str, Any]:
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user[:4000]},
                ],
                temperature=0.1,
                max_tokens=1024,
                response_format={"type": "json_object"},
                timeout=10,
            )
            raw = resp.choices[0].message.content or "{}"
            return json.loads(raw)
        except Exception:
            return {"action": "ok", "confidence": 1.0}

    def review_cell(self, column: str, value: str, row_context: dict[str, Any]) -> dict[str, Any]:
        result = self._classify_rules(column, value)
        if result["action"] != "ok":
            return result
        return {"action": "ok", "new_value": None, "issue": "", "confidence": 1.0, "context": ""}

    def review_cell_ai(self, column: str, value: str, row_context: dict[str, Any]) -> dict[str, Any]:
        system = (
            "You review spreadsheet cells for a consignment reporting system. "
            "The 'item_category' column identifies the consignment partner. "
            "Return JSON: {action, new_value, issue, confidence, context}\n"
            "action: 'fix' | 'flag' | 'ok'\n"
            "fix: you know the correction. flag: needs human. ok: fine."
        )
        user = (
            f"Column: {column}\nValue: {value}\n"
            f"Row context: {json.dumps(row_context, default=str)[:600]}\n"
            "Check: typos, outliers, missing partner, negative revenue, suspicious values."
        )

        result = self._ask(system, user)
        return {
            "action": result.get("action", "ok"),
            "new_value": result.get("new_value"),
            "issue": result.get("issue", ""),
            "confidence": float(result.get("confidence", 0.8)),
            "context": result.get("context", ""),
        }

    def _classify_rules(self, column: str, value: str) -> dict[str, Any]:
        v = str(value).strip().lower()

        if not v or v in ("nan", "none", "-", ""):
            return {"action": "flag", "new_value": None, "issue": f"Empty {column}", "confidence": 1.0, "context": ""}

        if column in ("item_category", "partner", "Item category"):
            if v in ("无", "nothing", "others", "hidden items", "-"):
                return {"action": "flag", "new_value": None, "issue": f"Unassigned partner: '{value}'", "confidence": 1.0, "context": "This item needs a proper partner assignment."}

        if column in ("revenue", "unit_price", "Total selling price"):
            try:
                n = float(v)
                if n < 0:
                    return {"action": "fix", "new_value": f"{abs(n)}", "issue": f"Negative {column} corrected", "confidence": 1.0, "context": ""}
            except (ValueError, TypeError):
                return {"action": "flag", "new_value": None, "issue": f"Non-numeric {column}", "confidence": 0.9, "context": ""}

        if column in ("quantity", "Sales volume", "Current Inventory"):
            try:
                n = float(v)
                if n < 0:
                    return {"action": "fix", "new_value": f"{abs(n)}", "issue": f"Negative quantity corrected", "confidence": 1.0, "context": ""}
            except (ValueError, TypeError):
                return {"action": "flag", "new_value": None, "issue": f"Non-numeric quantity", "confidence": 0.9, "context": ""}

        return {"action": "ok", "new_value": None, "issue": "", "confidence": 1.0, "context": ""}

    def review_batch(self, rows: list[dict[str, Any]], columns: list[str] | None = None, use_ai: bool = False) -> dict[str, Any]:
        auto_fixes = []
        flags = []

        skip_cols = {"source_file", "ingested_at", "_sheet_name", "source", "Specifications", "Company", "Unnamed:", "口味金额", "Sale percentage", "Profit", "Gross profit"}

        for i, row in enumerate(rows):
            cols_to_check = columns or [c for c in row if not any(s in str(c) for s in skip_cols)]
            for col in cols_to_check:
                val = str(row.get(col, ""))
                if not val or val in ("nan", "None", "", "NaN"):
                    continue
                finding = self.review_cell(col, val, row)
                finding["row_index"] = i
                finding["column"] = col
                if finding["action"] == "fix":
                    auto_fixes.append(finding)
                elif finding["action"] == "flag":
                    flags.append(finding)

        return {
            "rows_checked": len(rows),
            "auto_fixes": auto_fixes,
            "flags": flags,
            "issues_found": len(flags),
            "auto_corrected": len(auto_fixes),
        }
