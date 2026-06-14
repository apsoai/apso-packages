"""The mapper — the extension point that keeps app semantics out of the library.

``event_type`` turns an (entity name, action) pair into a dotted event type;
``to_payload`` turns an entity + action into a JSON-serializable payload.
Apps may subclass :class:`DefaultDomainEventMapper` (or implement the
:class:`DomainEventMapper` protocol) to customize either.
"""

from __future__ import annotations

from typing import Any

try:  # Protocol is the lightweight structural interface.
    from typing import Protocol, runtime_checkable
except ImportError:  # pragma: no cover - 3.9 has these
    from typing_extensions import Protocol, runtime_checkable  # type: ignore

from sqlalchemy import inspect as sa_inspect


# action ∈ created | updated | removed
ACTION_CREATED = "created"
ACTION_UPDATED = "updated"
ACTION_REMOVED = "removed"


@runtime_checkable
class DomainEventMapper(Protocol):
    """Structural interface for mappers."""

    def event_type(self, entity_name: str, action: str) -> str:
        ...

    def to_payload(self, entity: Any, action: str) -> Any:
        ...


def _lower_camel(name: str) -> str:
    """Lower-camel the first character of an entity name (``Product`` -> ``product``).

    Mirrors the TypeScript reference, which lower-cases the leading character
    only (e.g. ``ProductLine`` -> ``productLine``).
    """
    if not name:
        return name
    return name[0].lower() + name[1:]


class DefaultDomainEventMapper:
    """Default mapper: ``"{lowerCamel(entityName)}.{action}"`` + shallow serialization."""

    def event_type(self, entity_name: str, action: str) -> str:
        return f"{_lower_camel(entity_name)}.{action}"

    def to_payload(self, entity: Any, action: str) -> Any:
        """Serialize the entity shallowly (its mapped column values)."""
        try:
            state = sa_inspect(entity)
            mapper = state.mapper
        except Exception:
            # Not a mapped instance — fall back to __dict__ minus internals.
            return {
                k: v
                for k, v in vars(entity).items()
                if not k.startswith("_")
            }

        payload: dict = {}
        for col in mapper.columns:
            key = col.key
            payload[key] = _jsonable(getattr(entity, key, None))
        return payload


def _jsonable(value: Any) -> Any:
    """Coerce common non-JSON scalar types to JSON-friendly forms."""
    import datetime as _dt
    import decimal
    import uuid as _uuid

    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if isinstance(value, _uuid.UUID):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        import base64

        return base64.b64encode(bytes(value)).decode("ascii")
    return value
