"""Capture — same-transaction write via the SQLAlchemy ``before_flush`` event.

On insert / update / delete of an opted-in entity, we add a ``DomainEvent``
row to the SAME session so it commits in the same transaction as the state
change (the transactional outbox guarantee). This is NOT ``after_commit``.

Rules (per the contract):
- Recursion guard: never emit for the ``DomainEvent`` model itself.
- Scope: only the opted-in entity classes (passed at wiring time) emit.
- action ∈ created | updated | removed.
"""

from __future__ import annotations

from typing import Iterable, Tuple, Type

from sqlalchemy import event
from sqlalchemy.orm import Session

from .mapper import (
    ACTION_CREATED,
    ACTION_REMOVED,
    ACTION_UPDATED,
    DefaultDomainEventMapper,
    DomainEventMapper,
)
from .model import DomainEvent


def _entity_name(obj: object) -> str:
    return type(obj).__name__


def register_capture(
    entities: Iterable[Type],
    mapper: DomainEventMapper = None,
) -> DefaultDomainEventMapper:
    """Register a ``before_flush`` listener scoped to ``entities``.

    Returns the mapper in use. Idempotent registration is the caller's
    responsibility; calling twice will register twice.
    """
    opted_in: Tuple[Type, ...] = tuple(entities)
    active_mapper = mapper if mapper is not None else DefaultDomainEventMapper()

    def _is_opted_in(obj: object) -> bool:
        # Never recurse on our own outbox rows.
        if isinstance(obj, DomainEvent):
            return False
        return isinstance(obj, opted_in)

    def _before_flush(session: Session, flush_context, instances) -> None:
        # Snapshot the change sets first; we mutate the session by adding rows.
        emitted = []
        for obj in list(session.new):
            if _is_opted_in(obj):
                emitted.append((obj, ACTION_CREATED))
        for obj in list(session.dirty):
            # session.dirty can include objects with no net change; honor the
            # session's own modification tracking.
            if _is_opted_in(obj) and session.is_modified(
                obj, include_collections=False
            ):
                emitted.append((obj, ACTION_UPDATED))
        for obj in list(session.deleted):
            if _is_opted_in(obj):
                emitted.append((obj, ACTION_REMOVED))

        for obj, action in emitted:
            event_row = DomainEvent(
                type=active_mapper.event_type(_entity_name(obj), action),
                payload=active_mapper.to_payload(obj, action),
            )
            session.add(event_row)

    event.listen(Session, "before_flush", _before_flush)
    # Stash so callers/tests can deregister if needed.
    register_capture._last_listener = _before_flush  # type: ignore[attr-defined]
    return active_mapper


def unregister_capture(listener) -> None:
    """Remove a previously registered ``before_flush`` listener."""
    event.remove(Session, "before_flush", listener)
