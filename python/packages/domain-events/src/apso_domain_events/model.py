"""The ``DomainEvent`` SQLAlchemy model — table ``events``.

This is the transactional outbox row. State changes to opted-in entities
write one of these rows inside the same transaction (see :mod:`capture`),
and the relay (see :mod:`relay`) drains pending rows and fans them out to
the active delivery destinations.
"""

from __future__ import annotations

import datetime as _dt
import uuid
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    DateTime,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Status values (string, not a DB enum, to stay portable across backends).
STATUS_PENDING = "pending"
STATUS_PUBLISHED = "published"
STATUS_FAILED = "failed"


class Base(DeclarativeBase):
    """Declarative base for the library's own models.

    The ``DomainEvent`` table is created against whatever engine the host
    application wires in; it does not need to share the app's declarative
    base. Capture writes rows into the app's session regardless.
    """


def _utcnow() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


class DomainEvent(Base):
    """A captured domain event, awaiting (or past) delivery.

    Consumers MUST dedupe on :attr:`id` because fan-out is at-least-once and
    re-sends to all destinations on retry.
    """

    __tablename__ = "events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    type: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=STATUS_PENDING
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[_dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    published_at: Mapped[Optional[_dt.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_events_status_created_at", "status", "created_at"),
    )

    def to_dict(self) -> dict:
        """Serialize the event for transport (the webhook body / message)."""
        created = self.created_at
        published = self.published_at
        return {
            "id": self.id,
            "type": self.type,
            "payload": self.payload,
            "status": self.status,
            "attempts": self.attempts,
            "created_at": created.isoformat() if created is not None else None,
            "published_at": published.isoformat() if published is not None else None,
        }

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return (
            f"DomainEvent(id={self.id!r}, type={self.type!r}, "
            f"status={self.status!r}, attempts={self.attempts})"
        )
