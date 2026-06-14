"""Delivery destinations — runtime-selected, lazy broker deps.

The active destination(s) are chosen entirely at runtime from the
``EVENTS_DESTINATION`` env var (comma-separated → fan-out). A factory maps
each name to its adapter; an unknown value is a (startup) error.

Each adapter is pure transport: it takes a :class:`DomainEvent`, pushes it to
one sink, and **raises on failure** so the relay retries.

NOTE ON DELIVERY SEMANTICS: fan-out is at-least-once and re-sends to ALL
destinations on retry. Consumers MUST dedupe on ``event.id``. (A single
destination — the common case — is unaffected.)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List

try:
    from typing import Protocol, runtime_checkable
except ImportError:  # pragma: no cover
    from typing_extensions import Protocol, runtime_checkable  # type: ignore

from .model import DomainEvent


@runtime_checkable
class DeliveryDestination(Protocol):
    """A single transport sink."""

    name: str

    def deliver(self, event: DomainEvent) -> None:
        """Push ``event`` to the sink. Raise on failure so the relay retries."""
        ...


class MissingDependencyError(RuntimeError):
    """Raised when an activated destination's optional dependency is absent."""


class ConfigurationError(RuntimeError):
    """Raised for unknown destinations or missing required env config."""


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigurationError(
            f"{name} must be set for the configured destination"
        )
    return value


# --------------------------------------------------------------------------- #
# webhook — stdlib only (Standard Webhooks signing)
# --------------------------------------------------------------------------- #


def sign_webhook(msg_id: str, timestamp: int, body: str, secret: str) -> str:
    """Return the ``v1,{signature}`` header value per standardwebhooks.com.

    - ``signed_content = "{id}.{timestamp}.{body}"``
    - ``secret_bytes = base64_decode(secret without the "whsec_" prefix)``
    - ``signature = base64(HMAC_SHA256(signed_content, secret_bytes))``
    """
    key = secret[len("whsec_"):] if secret.startswith("whsec_") else secret
    secret_bytes = base64.b64decode(key)
    signed_content = f"{msg_id}.{timestamp}.{body}".encode("utf-8")
    digest = hmac.new(secret_bytes, signed_content, hashlib.sha256).digest()
    signature = base64.b64encode(digest).decode("utf-8")
    return f"v1,{signature}"


class WebhookDestination:
    """POSTs the JSON event to a single configured URL, Standard-Webhooks signed."""

    name = "webhook"

    def __init__(self, url: str, secret: str, timeout: float = 10.0) -> None:
        self.url = url
        self.secret = secret
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "WebhookDestination":
        return cls(
            url=_require_env("EVENTS_WEBHOOK_URL"),
            secret=_require_env("EVENTS_WEBHOOK_SECRET"),
        )

    def deliver(self, event: DomainEvent) -> None:
        body = json.dumps(event.to_dict(), separators=(",", ":"))
        timestamp = int(time.time())
        signature = sign_webhook(event.id, timestamp, body, self.secret)
        headers = {
            "content-type": "application/json",
            "webhook-id": event.id,
            "webhook-timestamp": str(timestamp),
            "webhook-signature": signature,
        }
        request = urllib.request.Request(
            self.url, data=body.encode("utf-8"), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as resp:
                status = resp.getcode()
                if status is None or not (200 <= status < 300):
                    raise RuntimeError(
                        f"webhook delivery failed with status {status}"
                    )
        except urllib.error.HTTPError as exc:  # non-2xx
            raise RuntimeError(
                f"webhook delivery failed with status {exc.code}"
            ) from exc


# --------------------------------------------------------------------------- #
# kafka — lazy optional dep
# --------------------------------------------------------------------------- #


class KafkaDestination:
    """Produces the JSON event to a Kafka topic. Lazy ``confluent_kafka`` import."""

    name = "kafka"

    def __init__(self, brokers: str, topic: str) -> None:
        self.brokers = brokers
        self.topic = topic
        self._producer = None

    @classmethod
    def from_env(cls) -> "KafkaDestination":
        return cls(
            brokers=_require_env("EVENTS_KAFKA_BROKERS"),
            topic=_require_env("EVENTS_KAFKA_TOPIC"),
        )

    def _get_producer(self):
        if self._producer is not None:
            return self._producer
        try:
            from confluent_kafka import Producer  # type: ignore
        except ImportError as exc:
            raise MissingDependencyError(
                "kafka destination requires confluent-kafka. "
                "Install with: pip install apso-domain-events[kafka]"
            ) from exc
        self._producer = Producer({"bootstrap.servers": self.brokers})
        return self._producer

    def deliver(self, event: DomainEvent) -> None:
        producer = self._get_producer()
        body = json.dumps(event.to_dict(), separators=(",", ":")).encode("utf-8")
        producer.produce(self.topic, key=event.id.encode("utf-8"), value=body)
        producer.flush()


# --------------------------------------------------------------------------- #
# sqs — lazy optional dep (boto3)
# --------------------------------------------------------------------------- #


class SqsDestination:
    """Sends the JSON event to an SQS queue. Lazy ``boto3`` import."""

    name = "sqs"

    def __init__(self, region: str, queue_url: str) -> None:
        self.region = region
        self.queue_url = queue_url
        self._client = None

    @classmethod
    def from_env(cls) -> "SqsDestination":
        return cls(
            region=_require_env("AWS_REGION"),
            queue_url=_require_env("EVENTS_SQS_QUEUE_URL"),
        )

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            import boto3  # type: ignore
        except ImportError as exc:
            raise MissingDependencyError(
                "sqs destination requires boto3. "
                "Install with: pip install apso-domain-events[aws]"
            ) from exc
        self._client = boto3.client("sqs", region_name=self.region)
        return self._client

    def deliver(self, event: DomainEvent) -> None:
        client = self._get_client()
        body = json.dumps(event.to_dict(), separators=(",", ":"))
        client.send_message(QueueUrl=self.queue_url, MessageBody=body)


# --------------------------------------------------------------------------- #
# eventbridge — lazy optional dep (boto3)
# --------------------------------------------------------------------------- #


class EventBridgeDestination:
    """Puts the JSON event on an EventBridge bus. Lazy ``boto3`` import."""

    name = "eventbridge"
    SOURCE = "apso.domain-events"

    def __init__(self, region: str, bus: str) -> None:
        self.region = region
        self.bus = bus
        self._client = None

    @classmethod
    def from_env(cls) -> "EventBridgeDestination":
        return cls(
            region=_require_env("AWS_REGION"),
            bus=_require_env("EVENTS_EVENTBRIDGE_BUS"),
        )

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            import boto3  # type: ignore
        except ImportError as exc:
            raise MissingDependencyError(
                "eventbridge destination requires boto3. "
                "Install with: pip install apso-domain-events[aws]"
            ) from exc
        self._client = boto3.client("events", region_name=self.region)
        return self._client

    def deliver(self, event: DomainEvent) -> None:
        client = self._get_client()
        detail = json.dumps(event.to_dict(), separators=(",", ":"))
        response = client.put_events(
            Entries=[
                {
                    "Source": self.SOURCE,
                    "DetailType": event.type,
                    "Detail": detail,
                    "EventBusName": self.bus,
                }
            ]
        )
        failed = response.get("FailedEntryCount", 0)
        if failed:
            raise RuntimeError(
                f"eventbridge delivery failed for {failed} entr(ies)"
            )


# --------------------------------------------------------------------------- #
# factory
# --------------------------------------------------------------------------- #

_FACTORIES: Dict[str, Any] = {
    "webhook": WebhookDestination.from_env,
    "kafka": KafkaDestination.from_env,
    "sqs": SqsDestination.from_env,
    "eventbridge": EventBridgeDestination.from_env,
}


def build_destinations(env_value: Any = None) -> List[DeliveryDestination]:
    """Build the active destinations from ``EVENTS_DESTINATION`` (comma list).

    An unknown destination name is an error. Returns the constructed adapters
    (each already validated for its required env config).
    """
    if env_value is None:
        env_value = os.environ.get("EVENTS_DESTINATION", "")
    names = [n.strip() for n in str(env_value).split(",") if n.strip()]
    if not names:
        raise ConfigurationError(
            "EVENTS_DESTINATION must name at least one destination "
            f"(one of: {', '.join(sorted(_FACTORIES))})"
        )
    destinations: List[DeliveryDestination] = []
    for name in names:
        factory = _FACTORIES.get(name)
        if factory is None:
            raise ConfigurationError(
                f"Unknown EVENTS_DESTINATION {name!r}. "
                f"Known destinations: {', '.join(sorted(_FACTORIES))}"
            )
        destinations.append(factory())
    return destinations
