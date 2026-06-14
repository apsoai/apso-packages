# @apso/domain-events

Durable **domain-event spine** for NestJS + TypeORM — the standard
**transactional outbox** pattern, surfaced with generic domain-event naming.

State changes to opted-in entities write a `DomainEvent` row **in the same
transaction**; a self-contained relay drains pending rows and fans them out to
runtime-selected delivery destinations.

See the cross-language [`CONTRACT.md`](../../../CONTRACT.md) for the behavior all
language implementations honor (TypeScript is the reference).

## Install

```bash
npm install @apso/domain-events
```

Peer deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/typeorm`, `typeorm`,
`rxjs`. Broker SDKs (`@nestjs/microservices` + `kafkajs`, `@aws-sdk/client-sqs`,
`@aws-sdk/client-eventbridge`) are **optional** and loaded lazily — a
webhook-only deployment needs none of them.

## Wire it up

```ts
import { DomainEventsModule } from '@apso/domain-events';
import { Product } from './product/product.entity';

@Module({
  imports: [
    DomainEventsModule.forRoot({
      entities: [Product], // the CLI-emitted manifest of opted-in entities
      // mapper?: MyDomainEventMapper,  // optional override
      // pollIntervalMs?: 5000,         // optional, default 5000
    }),
  ],
})
export class AppModule {}
```

`forRoot` is `@Global()`. The relay starts its own `setInterval` drain on
application bootstrap and clears it on shutdown — **no external scheduler
dependency**.

## Delivery destinations

Active destinations are chosen ENTIRELY at runtime from `EVENTS_DESTINATION`
(comma-separated → fan-out). Unknown name → startup error.

| name | env | dependency |
|---|---|---|
| `webhook` | `EVENTS_WEBHOOK_URL`, `EVENTS_WEBHOOK_SECRET` | none (native fetch + crypto) |
| `kafka` | `EVENTS_KAFKA_BROKERS`, `EVENTS_KAFKA_TOPIC` | `@nestjs/microservices` + `kafkajs` (lazy) |
| `sqs` | `AWS_REGION`, `EVENTS_SQS_QUEUE_URL` | `@aws-sdk/client-sqs` (lazy) |
| `eventbridge` | `AWS_REGION`, `EVENTS_EVENTBRIDGE_BUS` | `@aws-sdk/client-eventbridge` (lazy) |

The webhook adapter signs with [Standard Webhooks](https://www.standardwebhooks.com/)
(`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<sig>`).

## Duplicates — consumer-side dedupe is MANDATORY with multiple destinations

Delivery is at-least-once and tracked at the **event grain** (a single
`events.status`), NOT per (event × destination). With more than one active
destination, a failure in any one destination retries the **whole** event, so
healthy destinations receive it **again** on every retry. Consumers MUST dedupe
on `event.id` whenever multiple destinations are active. (A single destination —
the common case — never duplicates beyond ordinary at-least-once.)
