"""apso-domain-events — transactional outbox + delivery for SQLAlchemy / FastAPI.

Public API:

- :func:`register_domain_events` — the wiring entrypoint.
- :class:`DomainEvent` — the ``events`` table model.
- :class:`DomainEventMapper` / :class:`DefaultDomainEventMapper` — event mapping.
- :class:`DomainEventRelay` — the relay + self-contained poller.
- Delivery destinations + the ``EVENTS_DESTINATION`` factory.

Delivery is at-least-once and re-sends to all destinations on retry, so
consumers MUST dedupe on ``DomainEvent.id``.
"""

from .capture import register_capture, unregister_capture
from .delivery import (
    ConfigurationError,
    DeliveryDestination,
    EventBridgeDestination,
    KafkaDestination,
    MissingDependencyError,
    SqsDestination,
    WebhookDestination,
    build_destinations,
    sign_webhook,
)
from .mapper import (
    ACTION_CREATED,
    ACTION_REMOVED,
    ACTION_UPDATED,
    DefaultDomainEventMapper,
    DomainEventMapper,
)
from .model import (
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_PUBLISHED,
    Base,
    DomainEvent,
)
from .registration import DomainEvents, register_domain_events
from .relay import MAX_ATTEMPTS, DomainEventRelay

__all__ = [
    "register_domain_events",
    "DomainEvents",
    "DomainEvent",
    "Base",
    "STATUS_PENDING",
    "STATUS_PUBLISHED",
    "STATUS_FAILED",
    "DomainEventMapper",
    "DefaultDomainEventMapper",
    "ACTION_CREATED",
    "ACTION_UPDATED",
    "ACTION_REMOVED",
    "DomainEventRelay",
    "MAX_ATTEMPTS",
    "DeliveryDestination",
    "WebhookDestination",
    "KafkaDestination",
    "SqsDestination",
    "EventBridgeDestination",
    "build_destinations",
    "sign_webhook",
    "ConfigurationError",
    "MissingDependencyError",
    "register_capture",
    "unregister_capture",
]

__version__ = "0.1.0"
