from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from src.ai import assurance
from src.combine import merge_sheets, get_unique_categories
from src.comments import CommentManager
from src.db import init_db, create_task, update_task, get_task, get_tasks
from src.google_sheets import sheets_client
from src.hitl import email_handler
from src.ingestion import (
    parse_file,
    normalize_columns,
    standardize_locations,
    get_partner_list,
    compute_file_hash,
)
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
from src.normalize import normalizer
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
# Stage 1: Ingestion & Normalization
# ---------------------------------------------------------------------------

class IngestResponse(BaseModel):
    filename: str
    source: str
    rows: int
    columns: int
    column_names: list[str]
    partners: list[str]
    preview: list[dict[str, Any]]
    corrections_summary: dict[str, Any] | None = None
    file_hash: str
    normalized: bool = False


@app.post("/ingest", response_model=IngestResponse)
async def ingest_file(file_path: str, source: str | None = None, apply_corrections: bool = False):
    path = Path(file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    df = parse_file(path, source)
    df = normalize_columns(df)
    df = standardize_locations(df)

    file_hash = compute_file_hash(path)

    if apply_corrections:
        normalizer.load_corrections("data/corrections/reference.csv")
        df = normalizer.apply_global_corrections(df)

    partners = get_partner_list(df)
    preview = df.head(5).fillna("").to_dict(orient="records")

    return IngestResponse(
        filename=path.name,
        source=df["source"].iloc[0] if "source" in df.columns else "unknown",
        rows=len(df),
        columns=len(df.columns),
        column_names=list(df.columns),
        partners=partners[:20],
        preview=preview,
        corrections_summary=normalizer.get_corrections_summary() if apply_corrections else None,
        file_hash=file_hash,
        normalized=True,
    )


@app.get("/ingest/partners")
async def list_partners(file_path: str):
    path = Path(file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    df = parse_file(path)
    df = normalize_columns(df)
    partners = get_partner_list(df)
    return {"partners": partners, "count": len(partners)}


@app.get("/ingest/partner-skus")
async def partner_skus(file_path: str, partner: str):
    path = Path(file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    df = parse_file(path)
    df = normalize_columns(df)
    if "partner" in df.columns and "sku" in df.columns:
        partner_df = df[df["partner"] == partner]
        skus = partner_df[["sku", "item_description"]].dropna().drop_duplicates().to_dict(orient="records")
        return {"partner": partner, "sku_count": len(skus), "skus": skus}
    return {"partner": partner, "sku_count": 0, "skus": []}


@app.post("/ingest/corrections/load")
async def load_corrections(file_path: str = "data/corrections/reference.csv"):
    path = Path(file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Corrections file not found: {file_path}")

    corrections = normalizer.load_corrections(path)
    return {"corrections_loaded": len(corrections), "columns_covered": list(corrections.keys())}


# ---------------------------------------------------------------------------
# Stage 4: Google Sheets output
# ---------------------------------------------------------------------------

class CreateReportRequest(BaseModel):
    spreadsheet_title: str
    sheet_name: str = "Sheet1"
    headers: list[str]
    rows: list[list[Any]]


@app.post("/sheets/create")
async def create_report(req: CreateReportRequest):
    result = sheets_client.create_spreadsheet(req.spreadsheet_title)
    sheet_id = result["spreadsheet_id"]

    data = [req.headers] + req.rows
    cells = sheets_client.write_data(sheet_id, "A1", data, req.sheet_name)
    sheets_client.format_header(sheet_id)

    return {
        "spreadsheet_id": sheet_id,
        "url": result["url"],
        "cells_written": cells,
    }


# ---------------------------------------------------------------------------
# Stage 2: Combine & Review
# ---------------------------------------------------------------------------

class CombineRequest(BaseModel):
    file_paths: list[str]
    corrections_reference: str = "data/corrections/reference.csv"


@app.post("/pipeline/combine")
async def combine_files(req: CombineRequest):
    for path in req.file_paths:
        if not Path(path).exists():
            raise HTTPException(status_code=404, detail=f"File not found: {path}")

    master = merge_sheets(req.file_paths)

    normalizer.load_corrections(req.corrections_reference)
    master = normalizer.apply_global_corrections(master)

    categories = get_unique_categories(master)
    preview = master.head(5).fillna("").to_dict(orient="records")

    return {
        "total_rows": len(master),
        "total_columns": len(master.columns),
        "column_names": list(master.columns),
        "categories": categories,
        "category_count": len(categories),
        "corrections_applied": normalizer.get_corrections_summary(),
        "preview": preview,
    }


@app.post("/pipeline/combine/write")
async def combine_and_write(req: CombineRequest):
    for path in req.file_paths:
        if not Path(path).exists():
            raise HTTPException(status_code=404, detail=f"File not found: {path}")

    master = merge_sheets(req.file_paths)
    normalizer.load_corrections(req.corrections_reference)
    master = normalizer.apply_global_corrections(master)

    result = sheets_client.create_spreadsheet("Master Table — The Social Space")
    sheet_id = result["spreadsheet_id"]

    headers = list(master.columns)
    rows = master.fillna("").values.tolist()
    data_rows = [[str(v) for v in row] for row in rows]

    sheets_client.write_data(sheet_id, "A1", [headers] + data_rows, "Master")
    sheets_client.format_header(sheet_id)

    return {
        "spreadsheet_id": sheet_id,
        "url": result["url"],
        "rows_written": len(data_rows),
        "categories": get_unique_categories(master),
    }


class ReviewRequest(BaseModel):
    spreadsheet_id: str
    sheet_id: int = 0
    batch_size: int = 20
    review_columns: list[str] | None = None


@app.post("/pipeline/review")
async def review_master_table(req: ReviewRequest):
    from src.review import reviewer

    data = sheets_client.read_data(req.spreadsheet_id, "A1:ZZ1000")
    if not data:
        raise HTTPException(status_code=400, detail="No data found in spreadsheet")

    headers = data[0]
    rows_data = data[1:]

    dict_rows = []
    for row_data in rows_data:
        row_dict = {}
        for j, header in enumerate(headers):
            row_dict[header] = row_data[j] if j < len(row_data) else ""
        dict_rows.append(row_dict)

    findings = await reviewer.review_batch(dict_rows[:req.batch_size], req.review_columns)

    comment_mgr = CommentManager(sheets_client._get_service())

    comments_added = 0
    for flag in findings["flags"]:
        row_idx = flag.get("row_index", 0)
        col_name = flag.get("column_name", "")
        col_idx = _find_column_index(headers, col_name)
        if col_idx >= 0:
            comment_mgr.add_ai_comment(
                req.spreadsheet_id,
                req.sheet_id,
                row_idx + 1,
                col_idx,
                flag.get("issue", "Unknown issue"),
                flag.get("context", ""),
                col_name,
                str(dict_rows[row_idx].get(col_name, "")) if row_idx < len(dict_rows) else "",
            )
            comments_added += 1

    return {
        "rows_reviewed": min(len(dict_rows), req.batch_size),
        "auto_corrected": findings["auto_corrected"],
        "issues_found": findings["issues_found"],
        "comments_added": comments_added,
        "flags": findings["flags"],
    }


@app.get("/pipeline/review/comments")
async def get_review_comments(spreadsheet_id: str, sheet_id: int = 0):
    comment_mgr = CommentManager(sheets_client._get_service())
    comments = comment_mgr.get_comments(spreadsheet_id, sheet_id)
    return {"comments": comments, "count": len(comments)}


@app.post("/pipeline/reports/generate")
async def generate_reports(spreadsheet_id: str, category_col: str = "item_category"):
    from src.reports import generate_legacy_report, generate_recommended_report, get_partner_summary
    from src.combine import group_by_category

    data = sheets_client.read_data(spreadsheet_id, "A1:ZZ10000")
    if not data:
        raise HTTPException(status_code=400, detail="No data found")

    import pandas as pd
    headers = data[0]
    rows = data[1:]
    df = pd.DataFrame(rows, columns=headers)
    df = df.replace("", pd.NA)

    groups = group_by_category(df, category_col)
    reports_created = []

    for category, partner_df in list(groups.items())[:5]:
        if not category or category in ("nan", "None", ""):
            continue

        legacy_headers, legacy_rows = generate_legacy_report(partner_df, str(category))
        rec_headers, rec_rows = generate_recommended_report(partner_df, str(category))

        result = sheets_client.create_spreadsheet(f"Report — {category}")

        if legacy_headers and legacy_rows:
            sheets_client.write_data(
                result["spreadsheet_id"], "A1",
                [legacy_headers] + legacy_rows,
                "Legacy Report",
            )
            sheets_client.format_header(result["spreadsheet_id"])

        if rec_headers and rec_rows:
            sheets_client.write_data(
                result["spreadsheet_id"], "A1",
                [rec_headers] + rec_rows,
                "Recommended Report",
            )
            sheets_client.format_header(result["spreadsheet_id"])

        summary = get_partner_summary(partner_df, str(category))
        reports_created.append({
            "partner": str(category),
            "url": result["url"],
            "summary": summary,
        })

    return {
        "reports_created": len(reports_created),
        "reports": reports_created,
    }


def _find_column_index(headers: list[str], col_name: str) -> int:
    for i, h in enumerate(headers):
        if h == col_name or h.lower() == col_name.lower():
            return i
    return -1


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
