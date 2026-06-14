"""Delivery factory selection from EVENTS_DESTINATION."""

import pytest

from apso_domain_events import (
    ConfigurationError,
    WebhookDestination,
    build_destinations,
)


def test_unknown_destination_is_error():
    with pytest.raises(ConfigurationError):
        build_destinations("carrier-pigeon")


def test_empty_destination_is_error():
    with pytest.raises(ConfigurationError):
        build_destinations("")


def test_webhook_destination_built(monkeypatch):
    monkeypatch.setenv("EVENTS_WEBHOOK_URL", "https://example.test/hook")
    monkeypatch.setenv("EVENTS_WEBHOOK_SECRET", "whsec_abc")
    dests = build_destinations("webhook")
    assert len(dests) == 1
    assert isinstance(dests[0], WebhookDestination)
    assert dests[0].name == "webhook"


def test_fan_out_comma_list(monkeypatch):
    monkeypatch.setenv("EVENTS_WEBHOOK_URL", "https://example.test/hook")
    monkeypatch.setenv("EVENTS_WEBHOOK_SECRET", "whsec_abc")
    # Mix a known-good webhook with an unknown → still errors on the unknown.
    with pytest.raises(ConfigurationError):
        build_destinations("webhook,carrier-pigeon")


def test_webhook_requires_env(monkeypatch):
    monkeypatch.delenv("EVENTS_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("EVENTS_WEBHOOK_SECRET", raising=False)
    with pytest.raises(ConfigurationError):
        build_destinations("webhook")


def test_reads_env_var_when_no_arg(monkeypatch):
    monkeypatch.setenv("EVENTS_DESTINATION", "webhook")
    monkeypatch.setenv("EVENTS_WEBHOOK_URL", "https://example.test/hook")
    monkeypatch.setenv("EVENTS_WEBHOOK_SECRET", "whsec_abc")
    dests = build_destinations()
    assert len(dests) == 1
