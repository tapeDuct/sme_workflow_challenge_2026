from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from src.db import get_engine, Base
from src.main import app


def _setup_db():
    engine = get_engine()
    Base.metadata.create_all(engine)


def _teardown_db():
    engine = get_engine()
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def setup_database():
    _setup_db()
    yield
    _teardown_db()


client = TestClient(app)


def test_create_task():
    resp = client.post("/tasks", json={
        "task_type": "pdf_extraction",
        "input_type": "pdf",
        "input_data": {"source": "test_construction_plan.pdf"},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["task_type"] == "pdf_extraction"
    assert data["status"] == "pending"
    assert data["id"] is not None


def test_list_tasks():
    # Ensure at least one task exists
    client.post("/tasks", json={"task_type": "test", "input_type": "text"})
    resp = client.get("/tasks")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) >= 1


def test_get_task_not_found():
    resp = client.get("/tasks/99999")
    assert resp.status_code == 404


def test_get_summary():
    resp = client.get("/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_tasks" in data
    assert "estimated_hours_saved" in data


def test_get_metrics():
    resp = client.get("/metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert "tasks_processed" in data


def test_brave_search_no_key():
    resp = client.get("/integrations/search?q=test")
    assert resp.status_code == 200
    assert resp.json()["results"] == []


def test_hitl_email_approve():
    with patch("src.main.generation.generate_output", AsyncMock(return_value={"status": "processed"})):
        create_resp = client.post("/tasks", json={"task_type": "test", "input_type": "text"})
        task_id = create_resp.json()["id"]
        resp = client.get(f"/hitl/email-approve/fake-session?task_id={task_id}")
        assert resp.status_code == 200
        assert "Approved" in resp.text


def test_hitl_email_reject():
    create_resp = client.post("/tasks", json={"task_type": "test", "input_type": "text"})
    task_id = create_resp.json()["id"]
    resp = client.get(f"/hitl/email-reject/fake-session?task_id={task_id}")
    assert resp.status_code == 200
    assert "Rejected" in resp.text


def test_ai_assurance_pii_detection():
    from src.ai import assurance
    text = "Contact john@example.com or call 91234567. NRIC: S1234567A"
    pii = assurance.detect_pii(text)
    assert "email" in pii
    assert "phone" in pii
    assert "nric" in pii


def test_ai_assurance_mask_pii():
    from src.ai import assurance
    text = "Contact john@example.com. Card: 4111-1111-1111-1111"
    masked = assurance.mask_pii(text)
    assert "john@example.com" not in masked


def test_ai_assurance_should_escalate():
    from src.ai import assurance
    assert assurance.should_escalate(0.5, threshold=0.85) is True
    assert assurance.should_escalate(0.9, threshold=0.85) is False


def test_models_workflow_task_needs_human():
    from src.models import WorkflowTask, InputType

    task = WorkflowTask(
        task_type="test",
        input_type=InputType.text,
        confidence_score=0.5,
    )
    assert task.needs_human_review is True

    task2 = WorkflowTask(
        task_type="test",
        input_type=InputType.text,
        confidence_score=0.95,
    )
    assert task2.needs_human_review is False


@pytest.mark.asyncio
async def test_extraction_text():
    with patch("src.services.ai") as mock_ai:
        from src.services import extraction
        from pydantic import BaseModel

        mock_ai.structured_extract = AsyncMock(return_value=({"name": "Test", "amount": "100"}, 0.9, []))

        class FakeSchema(BaseModel):
            name: str
            amount: str

        result = await extraction.extract_from_text("Invoice #123 for $100", FakeSchema, "Extract invoice data")
        assert result.success is True
        assert result.confidence == 0.9


@pytest.mark.asyncio
async def test_extraction_low_confidence():
    with patch("src.services.ai") as mock_ai:
        from src.services import extraction
        from pydantic import BaseModel

        mock_ai.structured_extract = AsyncMock(return_value=({"name": "Test"}, 0.4, ["name"]))

        class FakeSchema(BaseModel):
            name: str

        result = await extraction.extract_from_text("some unclear text", FakeSchema, "Extract")
        assert result.confidence == 0.4
        assert "name" in result.low_confidence_fields
