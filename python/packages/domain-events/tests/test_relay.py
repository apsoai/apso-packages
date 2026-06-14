"""Relay process_pending: status/published_at/attempts/MAX_ATTEMPTS."""

from sqlalchemy import select

from apso_domain_events import (
    MAX_ATTEMPTS,
    DomainEvent,
    DomainEventRelay,
)


class _OkDest:
    name = "ok"

    def __init__(self):
        self.delivered = []

    def deliver(self, event):
        self.delivered.append(event.id)


class _FailDest:
    name = "fail"

    def deliver(self, event):
        raise RuntimeError("boom")


def test_process_pending_publishes_on_success(Session):
    session = Session()
    session.add(DomainEvent(type="product.created", payload={"a": 1}))
    session.commit()
    session.close()

    dest = _OkDest()
    relay = DomainEventRelay(Session, destinations=[dest])
    processed = relay.process_pending()
    assert processed == 1
    assert len(dest.delivered) == 1

    session = Session()
    evt = session.execute(select(DomainEvent)).scalars().one()
    assert evt.status == "published"
    assert evt.published_at is not None
    assert evt.attempts == 0
    session.close()


def test_process_pending_marks_failed_after_max_attempts(Session):
    session = Session()
    session.add(DomainEvent(type="product.created", payload={"a": 1}))
    session.commit()
    session.close()

    relay = DomainEventRelay(Session, destinations=[_FailDest()])
    for i in range(MAX_ATTEMPTS):
        relay.process_pending()
        session = Session()
        evt = session.execute(select(DomainEvent)).scalars().one()
        if i < MAX_ATTEMPTS - 1:
            # still pending and retried while attempts < MAX
            assert evt.attempts == i + 1
            if evt.attempts < MAX_ATTEMPTS:
                assert evt.status == "pending"
        session.close()

    session = Session()
    evt = session.execute(select(DomainEvent)).scalars().one()
    assert evt.attempts == MAX_ATTEMPTS
    assert evt.status == "failed"
    session.close()


def test_process_pending_orders_and_limits(Session):
    session = Session()
    for i in range(3):
        session.add(DomainEvent(type=f"e.{i}", payload={}))
    session.commit()
    session.close()

    dest = _OkDest()
    relay = DomainEventRelay(Session, destinations=[dest])
    processed = relay.process_pending(limit=2)
    assert processed == 2
