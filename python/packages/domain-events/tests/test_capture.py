"""Capture via before_flush, scoped to opted-in entities, with recursion guard."""

import pytest
from sqlalchemy import select

from apso_domain_events import DomainEvent
from apso_domain_events.capture import register_capture, unregister_capture

from models import AuditLog, Product


@pytest.fixture()
def capture(Session):
    register_capture([Product])
    listener = register_capture._last_listener
    yield
    unregister_capture(listener)


def test_insert_opted_in_writes_event_same_session(Session, capture):
    session = Session()
    session.add(Product(name="Widget"))
    session.commit()

    events = list(session.execute(select(DomainEvent)).scalars())
    assert len(events) == 1
    assert events[0].type == "product.created"
    assert events[0].status == "pending"
    assert events[0].payload["name"] == "Widget"
    session.close()


def test_update_opted_in_emits_updated(Session, capture):
    session = Session()
    p = Product(name="Widget")
    session.add(p)
    session.commit()
    # clear out the created event to isolate the update
    for e in session.execute(select(DomainEvent)).scalars():
        session.delete(e)
    session.commit()

    p.name = "Gadget"
    session.commit()
    events = list(session.execute(select(DomainEvent)).scalars())
    types = [e.type for e in events]
    assert "product.updated" in types
    session.close()


def test_delete_opted_in_emits_removed(Session, capture):
    session = Session()
    p = Product(name="Widget")
    session.add(p)
    session.commit()
    for e in session.execute(select(DomainEvent)).scalars():
        session.delete(e)
    session.commit()

    session.delete(p)
    session.commit()
    events = list(session.execute(select(DomainEvent)).scalars())
    assert any(e.type == "product.removed" for e in events)
    session.close()


def test_non_opted_in_writes_nothing(Session, capture):
    session = Session()
    session.add(AuditLog(message="nope"))
    session.commit()

    events = list(session.execute(select(DomainEvent)).scalars())
    assert events == []
    session.close()


def test_domain_event_does_not_recurse(Session, capture):
    # Manually inserting a DomainEvent must not trigger another DomainEvent.
    session = Session()
    session.add(DomainEvent(type="manual.test", payload={"x": 1}))
    session.commit()

    events = list(session.execute(select(DomainEvent)).scalars())
    assert len(events) == 1
    assert events[0].type == "manual.test"
    session.close()
