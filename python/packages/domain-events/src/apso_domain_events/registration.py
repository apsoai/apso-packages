"""Public wiring entrypoint: :func:`register_domain_events`.

The CLI emits a manifest (the list of opted-in entities); the host app passes
it here. The library never hardcodes the entity set.
"""

from __future__ import annotations

from typing import Iterable, List, Optional, Type

from .capture import register_capture
from .delivery import DeliveryDestination
from .mapper import DomainEventMapper
from .relay import DomainEventRelay, make_session_factory


class DomainEvents:
    """Handle returned by :func:`register_domain_events`.

    Holds the active mapper and relay; exposes the capture listener (so it can
    be deregistered) and start/stop for the poller when no FastAPI app wires
    the lifecycle automatically.
    """

    def __init__(self, relay: DomainEventRelay, mapper, capture_listener) -> None:
        self.relay = relay
        self.mapper = mapper
        self.capture_listener = capture_listener


def register_domain_events(
    engine_or_sessionmaker,
    entities: Iterable[Type],
    mapper: Optional[DomainEventMapper] = None,
    poll_interval: float = 5.0,
    app=None,
    destinations: Optional[List[DeliveryDestination]] = None,
) -> DomainEvents:
    """Wire domain-event capture + relay.

    Parameters
    ----------
    engine_or_sessionmaker:
        A SQLAlchemy ``Engine`` or ``sessionmaker`` used by the relay to drain
        pending events. Capture hooks the global ``Session`` event, so the
        app's own sessions emit events regardless of this binding.
    entities:
        The opted-in entity classes (the CLI manifest). Only these emit.
    mapper:
        Optional mapper override; defaults to ``DefaultDomainEventMapper``.
    poll_interval:
        Poller interval in seconds (default 5.0).
    app:
        Optional FastAPI app. If given, the poller is started on ``startup``
        and stopped on ``shutdown``.
    destinations:
        Optional pre-built destinations (mainly for tests). When omitted, the
        relay builds them lazily from ``EVENTS_DESTINATION`` at first poll.
    """
    active_mapper = register_capture(entities, mapper)
    capture_listener = getattr(register_capture, "_last_listener", None)

    session_factory = make_session_factory(engine_or_sessionmaker)
    relay = DomainEventRelay(
        session_factory=session_factory,
        destinations=destinations,
        poll_interval=poll_interval,
    )

    if app is not None:
        _wire_fastapi(app, relay)

    return DomainEvents(
        relay=relay, mapper=active_mapper, capture_listener=capture_listener
    )


def _wire_fastapi(app, relay: DomainEventRelay) -> None:
    """Start the poller on FastAPI startup, stop it on shutdown."""

    @app.on_event("startup")
    async def _start_domain_events_relay() -> None:  # pragma: no cover - needs app
        relay.start()

    @app.on_event("shutdown")
    async def _stop_domain_events_relay() -> None:  # pragma: no cover - needs app
        await relay.stop()
