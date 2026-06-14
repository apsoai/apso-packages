"""Mapper defaults."""

from apso_domain_events import DefaultDomainEventMapper


def test_event_type_lower_camel():
    m = DefaultDomainEventMapper()
    assert m.event_type("Product", "created") == "product.created"
    assert m.event_type("ProductLine", "updated") == "productLine.updated"
    assert m.event_type("Order", "removed") == "order.removed"


def test_to_payload_falls_back_for_plain_objects():
    class Plain:
        def __init__(self):
            self.name = "x"
            self._private = "hidden"

    m = DefaultDomainEventMapper()
    payload = m.to_payload(Plain(), "created")
    assert payload == {"name": "x"}
