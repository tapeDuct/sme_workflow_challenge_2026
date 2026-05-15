from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from src.ai import assurance
from src.db import init_db, create_task, update_task, get_task, get_tasks
from src.hitl import email_handler
from src.integrations import brave, apollo, zapier
from src.models import (
    ApprovalRequest,
    InputType,
    MetricsSnapshot,
    TaskStatus,
    WorkflowSummary,
    WorkflowTask,
    ExtractionResult,
)
from src.services import extraction, verification, generation, metrics


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    Path("data/output").mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="Echelon SG 2026 — SME Workflow Automation",
    version="1.0.0",
    docs_url="/docs",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Task endpoints
# ---------------------------------------------------------------------------

class CreateTaskRequest(BaseModel):
    task_type: str
    input_type: str
    input_data: dict[str, Any] = {}
    file_path: str | None = None


@app.post("/tasks", response_model=WorkflowTask)
async def create_workflow_task(req: CreateTaskRequest):
    record = create_task(
        task_type=req.task_type,
        input_type=req.input_type,
        input_data=req.input_data,
        file_path=req.file_path,
    )
    return _task_from_record(record)


@app.get("/tasks", response_model=list[WorkflowTask])
async def list_tasks(limit: int = Query(default=50, le=100)):
    records = get_tasks(limit)
    return [_task_from_record(r) for r in records]


@app.get("/tasks/{task_id}", response_model=WorkflowTask)
async def get_workflow_task(task_id: int):
    record = get_task(task_id)
    if not record:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_from_record(record)


# ---------------------------------------------------------------------------
# Workflow execution
# ---------------------------------------------------------------------------

@app.post("/tasks/{task_id}/run")
async def run_task(task_id: int):
    record = get_task(task_id)
    if not record:
        raise HTTPException(status_code=404, detail="Task not found")

    start_time = time.time()

    update_task(task_id, status=TaskStatus.processing.value)
    task = _task_from_db(record)

    # Step 1: Extract
    extraction_result: ExtractionResult
    if task.file_path and task.input_type in (InputType.pdf,):
        file_path = task.file_path if Path(task.file_path).exists() else f"data/input/{Path(task.file_path).name}"
        extraction_result = await extraction.extract_from_pdf(
            file_path, BaseModel, "Extract all relevant data from this document."
        )
    elif task.input_type in (InputType.image,):
        extraction_result = await extraction.extract_from_image(
            task.file_path or "", BaseModel, "Extract all visible data from this image."
        )
    else:
        content = str(task.input_data)
        extraction_result = await extraction.extract_from_text(
            content, BaseModel, "Extract all relevant structured data from this text."
        )

    # Step 2: Triage
    new_status = await verification.triage(task, extraction_result)

    update_task(
        task_id,
        extracted_data=extraction_result.data,
        confidence_score=extraction_result.confidence,
        status=new_status.value,
    )

    # Step 3: Handle low confidence → human review
    if new_status == TaskStatus.awaiting_human:
        approval_req = ApprovalRequest(
            task_id=task_id,
            task_type=task.task_type,
            summary=f"Extracted {len(extraction_result.data)} fields from {task.input_type.value}",
            extracted_data=extraction_result.data,
            confidence_score=extraction_result.confidence,
            low_confidence_fields=extraction_result.low_confidence_fields,
            action_url=f"http://localhost:8000/tasks/{task_id}",
        )
        email_handler.send_approval_request(approval_req)
        explanation = assurance.explain_low_confidence(
            extraction_result.low_confidence_fields, extraction_result.data
        )
        metrics.record_task(task, start_time)
        return {
            "status": "awaiting_human",
            "task_id": task_id,
            "confidence": extraction_result.confidence,
            "explanation": explanation,
            "warnings": extraction_result.warnings,
        }

    # Step 4: Auto-approved → generate output
    if new_status == TaskStatus.approved:
        output = await generation.generate_output(task)
        update_task(task_id, output_data=output, status=TaskStatus.completed.value)
        metrics.record_task(task, start_time)
        return {
            "status": "completed",
            "task_id": task_id,
            "confidence": extraction_result.confidence,
            "output": output,
        }

    metrics.record_task(task, start_time)
    return {"status": new_status.value, "task_id": task_id}


# ---------------------------------------------------------------------------
# Human-in-the-Loop endpoints
# ---------------------------------------------------------------------------

@app.get("/hitl/inbox")
async def hitl_inbox():
    return {"inbox": email_handler.get_inbox()}


@app.get("/hitl/email/{session_id}", response_class=HTMLResponse)
async def hitl_view_email(session_id: str):
    email = email_handler.get_email(session_id)
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return email["body_html"]


@app.get("/hitl/email-approve/{session_id}")
async def email_approve(session_id: str, task_id: int, corrections: str | None = None):
    email_handler.process_response(session_id, "approve", task_id)
    task = get_task(task_id)
    if task:
        output = await generation.generate_output(_task_from_record(task))
        update_task(task_id, status=TaskStatus.completed.value, output_data=output)
    return HTMLResponse("<h2>Task Approved</h2><p>The workflow will continue processing.</p>")


@app.get("/hitl/email-reject/{session_id}")
async def email_reject(session_id: str, task_id: int, reason: str | None = None):
    email_handler.process_response(session_id, "reject", task_id)
    update_task(task_id, status=TaskStatus.rejected.value, human_notes=reason)
    return HTMLResponse("<h2>Task Rejected</h2><p>The task has been flagged for manual review.</p>")


# ---------------------------------------------------------------------------
# Metrics & summary
# ---------------------------------------------------------------------------

@app.get("/metrics", response_model=MetricsSnapshot)
async def get_metrics():
    return metrics.snapshot()


@app.get("/summary", response_model=WorkflowSummary)
async def get_summary():
    records = get_tasks(1000)
    total = len(records)
    auto = sum(1 for r in records if r.status in ("completed",))
    human = sum(1 for r in records if r.status in ("approved", "rejected"))
    failed = sum(1 for r in records if r.status == "failed")
    confidences = [r.confidence_score for r in records if r.confidence_score is not None]
    avg_conf = sum(confidences) / len(confidences) if confidences else 0

    return WorkflowSummary(
        total_tasks=total,
        tasks_auto_completed=auto,
        tasks_human_reviewed=human,
        tasks_failed=failed,
        avg_confidence=avg_conf,
        estimated_hours_saved=total * 5 / 60,
        cost_per_task=round(0.03, 4),
    )


# ---------------------------------------------------------------------------
# Integrations
# ---------------------------------------------------------------------------

@app.get("/integrations/search")
async def search_web(q: str):
    results = await brave.search(q)
    return {"results": results}


@app.get("/integrations/enrich")
async def enrich_company(domain: str):
    data = await apollo.enrich_company(domain)
    return data


@app.post("/integrations/zapier")
async def trigger_zapier(payload: dict[str, Any]):
    success = await zapier.trigger(payload)
    return {"triggered": success}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _task_from_record(r) -> WorkflowTask:
    return WorkflowTask(
        id=r.id,
        task_type=r.task_type,
        status=TaskStatus(r.status),
        input_type=InputType(r.input_type),
        input_data=r.input_data or {},
        file_path=r.file_path,
        extracted_data=r.extracted_data or {},
        confidence_score=r.confidence_score,
        human_notes=r.human_notes,
        output_data=r.output_data or {},
        error_message=r.error_message,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _task_from_db(record) -> WorkflowTask:
    return WorkflowTask(
        id=record.id,
        task_type=record.task_type,
        status=TaskStatus(record.status),
        input_type=InputType(record.input_type),
        input_data=record.input_data or {},
        file_path=record.file_path,
        confidence_score=record.confidence_score,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
