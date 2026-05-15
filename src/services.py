import time
from typing import Any

import pymupdf

from src.ai import ai, assurance
from src.models import ExtractionResult, MetricsSnapshot, TaskStatus, WorkflowTask


class ExtractionService:
    async def extract_from_pdf(self, file_path: str, schema: type, prompt: str) -> ExtractionResult:
        try:
            doc = pymupdf.open(file_path)
            text = "\n".join(page.get_text() for page in doc)
            doc.close()
        except Exception as e:
            return ExtractionResult(success=False, data={}, confidence=0.0, warnings=[str(e)])

        return await self._extract(text, schema, prompt)

    async def extract_from_image(self, file_path: str, schema: type, prompt: str) -> ExtractionResult:
        import base64
        from pathlib import Path

        ext = Path(file_path).suffix.lower().lstrip(".")
        mime = f"image/{ext}" if ext in ("png", "jpeg", "jpg", "webp") else "image/png"

        with open(file_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                ],
            }
        ]
        output = await ai.chat(messages)
        data, conf, low_conf = ai._parse_json_with_confidence(output, schema)
        return ExtractionResult(
            success=conf > 0.3,
            data=data or {},
            confidence=conf,
            low_confidence_fields=low_conf,
        )

    async def extract_from_text(self, content: str, schema: type, prompt: str) -> ExtractionResult:
        return await self._extract(content, schema, prompt)

    async def _extract(self, content: str, schema: type, prompt: str) -> ExtractionResult:
        sanitized, pii_found = assurance.sanitize(content)
        data, confidence, low_conf = await ai.structured_extract(prompt, schema, sanitized)

        warnings = []
        if pii_found:
            warnings.append(f"PII detected and masked: {', '.join(pii_found)}")
        if confidence < 0.7:
            warnings.append("Low confidence extraction — human review recommended")

        return ExtractionResult(
            success=confidence > 0.3,
            data=data or {},
            confidence=confidence,
            low_confidence_fields=low_conf,
            warnings=warnings,
            raw_text=sanitized[:500] if len(sanitized) > 500 else sanitized,
        )


class VerificationService:
    async def triage(self, task: WorkflowTask, extraction_result: ExtractionResult) -> TaskStatus:
        if not extraction_result.success:
            return TaskStatus.failed

        if assurance.should_escalate(extraction_result.confidence):
            return TaskStatus.awaiting_human

        if extraction_result.low_confidence_fields:
            return TaskStatus.awaiting_human

        return TaskStatus.approved


class GenerationService:
    async def generate_output(self, task: WorkflowTask) -> dict[str, Any]:
        prompt = f"Generate a structured output from the extracted data for task type '{task.task_type}'. Format the data appropriately."

        messages = [
            {"role": "system", "content": "You generate clean, structured output from extracted data. Return JSON."},
            {"role": "user", "content": f"{prompt}\n\nExtracted data:\n{task.extracted_data}"},
        ]
        output = await ai.chat(messages)

        import json

        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return {"raw_output": output}


class MetricsService:
    def __init__(self):
        self.tasks: list[dict[str, Any]] = []

    def record_task(self, task: WorkflowTask, start_time: float) -> None:
        elapsed = time.time() - start_time
        self.tasks.append({
            "task_id": task.id,
            "status": task.status.value,
            "confidence": task.confidence_score,
            "elapsed_seconds": elapsed,
        })

    def snapshot(self) -> MetricsSnapshot:
        total = len(self.tasks)
        auto = sum(1 for t in self.tasks if t["status"] in ("completed", "approved"))
        human_reviewed = sum(1 for t in self.tasks if t["status"] in ("approved", "rejected") and t.get("human_review", False))

        estimates = {
            "pdf_extraction": 900,
            "data_entry": 300,
            "message_processing": 120,
            "verification": 180,
        }

        time_saved = 0.0
        for t in self.tasks:
            task_type = "pdf_extraction"
            auto_save = estimates.get(task_type, 300) - t["elapsed_seconds"]
            if auto_save > 0:
                time_saved += auto_save

        return MetricsSnapshot(
            tasks_processed=total,
            auto_completed=auto,
            human_reviewed=human_reviewed,
            human_approval_rate=human_reviewed / max(total, 1),
            avg_time_per_task_seconds=sum(t["elapsed_seconds"] for t in self.tasks) / max(total, 1),
            total_time_saved_minutes=time_saved / 60,
            total_cost=total * 0.03,
        )


extraction = ExtractionService()
verification = VerificationService()
generation = GenerationService()
metrics = MetricsService()
