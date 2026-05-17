from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    awaiting_human = "awaiting_human"
    approved = "approved"
    rejected = "rejected"
    completed = "completed"
    failed = "failed"


class InputType(str, Enum):
    pdf = "pdf"
    image = "image"
    text = "text"
    messenger = "messenger"
    social_media = "social_media"
    email = "email"


class WorkflowTask(BaseModel):
    id: Optional[int] = None
    task_type: str
    status: TaskStatus = TaskStatus.pending
    input_type: InputType
    input_data: dict[str, Any] = Field(default_factory=dict)
    file_path: Optional[str] = None
    extracted_data: dict[str, Any] = Field(default_factory=dict)
    confidence_score: Optional[float] = None
    human_notes: Optional[str] = None
    output_data: dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    @property
    def needs_human_review(self) -> bool:
        return (
            self.confidence_score is not None
            and self.confidence_score < 0.85
        ) or self.status == TaskStatus.awaiting_human


class ApprovalRequest(BaseModel):
    task_id: int
    task_type: str
    summary: str
    extracted_data: dict[str, Any]
    confidence_score: float
    low_confidence_fields: list[str] = Field(default_factory=list)
    action_url: str


class ApprovalResponse(BaseModel):
    task_id: int
    decision: str
    corrections: dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = None


class ExtractionResult(BaseModel):
    success: bool
    data: dict[str, Any] = Field(default_factory=dict)
    confidence: float
    low_confidence_fields: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    raw_text: Optional[str] = None


class WorkflowSummary(BaseModel):
    total_tasks: int
    tasks_auto_completed: int
    tasks_human_reviewed: int
    tasks_failed: int
    avg_confidence: float
    estimated_hours_saved: float
    cost_per_task: float


class MetricsSnapshot(BaseModel):
    tasks_processed: int
    auto_completed: int
    human_reviewed: int
    human_approval_rate: float
    avg_time_per_task_seconds: float
    total_time_saved_minutes: float
    total_cost: float
