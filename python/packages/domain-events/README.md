# apso-domain-events (Python)

Transactional outbox + delivery for Apso services, built on **SQLAlchemy 2.0**
with an optional **FastAPI** integration. Implements the cross-language
[`CONTRACT.md`](../../../CONTRACT.md).

```
state change ─(same DB txn)→ DomainEvent row (capture)
                                   │
                       relay drains pending rows (poller)
                                   │
                       fan out to active destination(s) (delivery)
```

## Install

```bash
pip install apso-domain-events            # webhook delivery needs no extra dep
pip install apso-domain-events[kafka]     # confluent-kafka
pip install apso-domain-events[aws]       # boto3 (sqs / eventbridge)
pip install apso-domain-events[fastapi]   # FastAPI integration
```

## Wire it

```python
from apso_domain_events import register_domain_events
from myapp.models import Product, Order  # the CLI-emitted manifest

register_domain_events(
    engine,                      # Engine or sessionmaker
    entities=[Product, Order],   # only these emit; never hardcoded in the lib
    poll_interval=5.0,
    app=app,                     # optional FastAPI app → startup/shutdown poller
)
```

Create the `events` table from `Base.metadata` (or your migration tool):

```python
from apso_domain_events import Base
Base.metadata.create_all(engine)
```

## Delivery

The active destination(s) are chosen at runtime from `EVENTS_DESTINATION`
(comma-separated → fan-out):

| name | env | dependency |
|---|---|---|
| `webhook` | `EVENTS_WEBHOOK_URL`, `EVENTS_WEBHOOK_SECRET` | none (stdlib HTTP + crypto) |
| `kafka` | `EVENTS_KAFKA_BROKERS`, `EVENTS_KAFKA_TOPIC` | `[kafka]` |
| `sqs` | `AWS_REGION`, `EVENTS_SQS_QUEUE_URL` | `[aws]` |
| `eventbridge` | `AWS_REGION`, `EVENTS_EVENTBRIDGE_BUS` | `[aws]` |

> **At-least-once:** fan-out re-sends to ALL destinations on retry. Consumers
> MUST dedupe on `event.id`.

The webhook adapter signs requests per
[Standard Webhooks](https://www.standardwebhooks.com/) (`webhook-id`,
`webhook-timestamp`, `webhook-signature: v1,...`).
