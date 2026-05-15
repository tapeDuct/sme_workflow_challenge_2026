from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import create_engine, JSON, Float, Integer, String, DateTime, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


class Base(DeclarativeBase):
    pass


class TaskRecord(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_type: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    input_type: Mapped[str] = mapped_column(String(30), nullable=False)
    input_data: Mapped[dict] = mapped_column(JSON, default=dict)
    file_path: Mapped[Optional[str]] = mapped_column(String(500))
    extracted_data: Mapped[dict] = mapped_column(JSON, default=dict)
    confidence_score: Mapped[Optional[float]] = mapped_column(Float)
    human_notes: Mapped[Optional[str]] = mapped_column(Text)
    output_data: Mapped[dict] = mapped_column(JSON, default=dict)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        db_url = os.environ.get("DATABASE_URL", "sqlite:///data/app.db")
        connect_args = {"check_same_thread": False} if "sqlite" in db_url else {}
        _engine = create_engine(db_url, connect_args=connect_args)
    return _engine


def init_db():
    engine = get_engine()
    Base.metadata.create_all(engine)


def get_session() -> Session:
    return Session(get_engine())


def create_task(task_type: str, input_type: str, input_data: dict[str, Any], file_path: str | None = None) -> TaskRecord:
    with get_session() as session:
        record = TaskRecord(
            task_type=task_type,
            input_type=input_type,
            input_data=input_data,
            file_path=file_path,
            status="pending",
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


def update_task(task_id: int, **kwargs) -> TaskRecord | None:
    with get_session() as session:
        record = session.get(TaskRecord, task_id)
        if not record:
            return None
        for key, value in kwargs.items():
            if hasattr(record, key):
                setattr(record, key, value)
        record.updated_at = datetime.utcnow()
        session.commit()
        session.refresh(record)
        return record


def get_task(task_id: int) -> TaskRecord | None:
    with get_session() as session:
        return session.get(TaskRecord, task_id)


def get_tasks(limit: int = 50) -> list[TaskRecord]:
    with get_session() as session:
        return session.query(TaskRecord).order_by(TaskRecord.created_at.desc()).limit(limit).all()
