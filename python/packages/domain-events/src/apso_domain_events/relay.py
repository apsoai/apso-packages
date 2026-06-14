"""Relay + self-contained asyncio poller.

The relay drains ``pending`` events, fans each out to the active
destination(s), and updates status / published_at / attempts. The poller is a
self-contained asyncio background task — no external scheduler dependency.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from .delivery import DeliveryDestination, build_destinations
from .model import (
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_PUBLISHED,
    DomainEvent,
)

logger = logging.getLogger("apso_domain_events")

MAX_ATTEMPTS = 5


class DomainEventRelay:
    """Drains pending domain events and delivers them to active destinations."""

    def __init__(
        self,
        session_factory: Callable[[], Session],
        destinations: Optional[List[DeliveryDestination]] = None,
        poll_interval: float = 5.0,
        now_fn: Optional[Callable[[], object]] = None,
    ) -> None:
        self._session_factory = session_factory
        self._destinations = destinations
        self.poll_interval = poll_interval
        self._now_fn = now_fn
        self._task: Optional[asyncio.Task] = None
        self._stop = None  # asyncio.Event, created on start

    # -- destinations are resolved lazily so wiring doesn't require env yet -- #
    def _get_destinations(self) -> List[DeliveryDestination]:
        if self._destinations is None:
            self._destinations = build_destinations()
        return self._destinations

    def _utcnow(self):
        if self._now_fn is not None:
            return self._now_fn()
        import datetime as _dt

        return _dt.datetime.now(_dt.timezone.utc)

    def process_pending(self, limit: int = 50) -> int:
        """Drain up to ``limit`` pending events; return the number processed."""
        session = self._session_factory()
        processed = 0
        try:
            stmt = (
                select(DomainEvent)
                .where(DomainEvent.status == STATUS_PENDING)
                .order_by(DomainEvent.created_at.asc())
                .limit(limit)
            )
            events = list(session.execute(stmt).scalars())
            destinations = self._get_destinations() if events else []
            for evt in events:
                processed += 1
                try:
                    for dest in destinations:
                        dest.deliver(evt)
                    evt.status = STATUS_PUBLISHED
                    evt.published_at = self._utcnow()
                except Exception as exc:  # noqa: BLE001 - relay must keep going
                    evt.attempts = (evt.attempts or 0) + 1
                    if evt.attempts >= MAX_ATTEMPTS:
                        evt.status = STATUS_FAILED
                    logger.warning(
                        "domain event %s delivery failed (attempt %d/%d): %s",
                        evt.id,
                        evt.attempts,
                        MAX_ATTEMPTS,
                        exc,
                    )
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
        return processed

    # ----------------------------- poller ------------------------------- #

    async def _run_loop(self) -> None:
        assert self._stop is not None
        while not self._stop.is_set():
            try:
                # Run the (blocking) DB work off the event loop.
                await asyncio.get_event_loop().run_in_executor(
                    None, self.process_pending
                )
            except Exception as exc:  # noqa: BLE001 - keep polling
                logger.exception("domain event relay poll failed: %s", exc)
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.poll_interval
                )
            except asyncio.TimeoutError:
                pass

    def start(self) -> None:
        """Start the background poller on the running event loop."""
        if self._task is not None and not self._task.done():
            return
        self._stop = asyncio.Event()
        self._task = asyncio.ensure_future(self._run_loop())

    async def stop(self) -> None:
        """Signal the poller to stop and await its completion."""
        if self._stop is not None:
            self._stop.set()
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:  # pragma: no cover
                pass
            self._task = None


def make_session_factory(engine_or_sessionmaker) -> Callable[[], Session]:
    """Coerce an Engine or sessionmaker into a zero-arg session factory."""
    if isinstance(engine_or_sessionmaker, sessionmaker):
        return engine_or_sessionmaker
    # Assume it's an Engine (or anything bindable).
    return sessionmaker(bind=engine_or_sessionmaker)
