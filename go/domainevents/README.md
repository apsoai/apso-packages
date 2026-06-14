# domainevents (Go / GORM)

Transactional outbox for Gin/GORM apps. The Go implementation of the cross-language
`domain-events` contract (see `../../CONTRACT.md`). TypeScript is the reference; this
mirrors it.

```
state change ─(same DB txn)→ DomainEvent row (capture)
                                   │
                       relay drains pending rows (poller)
                                   │
                       fan out to active destination(s) (delivery)
```

Module: `github.com/apsoai/apso-packages/go/domainevents` (Go 1.21+).

## Quick start

```go
import "github.com/apsoai/apso-packages/go/domainevents"

handle, err := domainevents.Register(db, domainevents.Options{
    Entities:     []any{Product{}, Order{}}, // the generated manifest
    Mapper:       nil,                        // nil → DefaultMapper
    PollInterval: 5 * time.Second,            // 0 → 5s default
    AutoMigrate:  true,                        // create the `events` table
})
if err != nil {
    log.Fatal(err)
}
defer handle.Stop() // stops the poller on shutdown
```

`Register`:

1. Registers GORM `AfterCreate`/`AfterUpdate`/`AfterDelete` callbacks that write a
   `DomainEvent` row **in the same transaction** as the state change, for opted-in
   entities only (recursion guard skips `DomainEvent` itself).
2. Resolves delivery destinations from `EVENTS_DESTINATION` (an unknown value is a
   startup error).
3. Starts a self-contained poller goroutine (no external scheduler). `Handle.Stop()`
   cancels its `context.Context` and waits for it to exit.

## The `DomainEvent` model → table `events`

| Field | Go type | Notes |
|---|---|---|
| `ID` | `string` (uuid) | primary key, generated in `BeforeCreate` |
| `Type` | `string` | e.g. `product.created` |
| `Payload` | `datatypes.JSON` | serialized payload |
| `Status` | `string` | `pending` \| `published` \| `failed`, default `pending` |
| `Attempts` | `int` | default `0` |
| `CreatedAt` | `time.Time` | set on insert |
| `PublishedAt` | `*time.Time` | nullable; set on delivery |

Composite index on `(status, created_at)` for relay polling.

## Mapper

`DefaultMapper` provides the contract defaults:

- `EventType("Product", "created")` → `"product.created"` (lowerCamel.action)
- `ToPayload(entity, action)` → the entity serialized as-is.

Implement the `Mapper` interface to override.

## Delivery destinations

Selected entirely at runtime via `EVENTS_DESTINATION` (comma-separated → fan-out):

| name | env | dependency |
|---|---|---|
| `webhook` | `EVENTS_WEBHOOK_URL`, `EVENTS_WEBHOOK_SECRET` | none (stdlib HTTP + crypto) |
| `kafka` | `EVENTS_KAFKA_BROKERS`, `EVENTS_KAFKA_TOPIC` | `segmentio/kafka-go` |
| `sqs` | `AWS_REGION`, `EVENTS_SQS_QUEUE_URL` | AWS SDK v2 |
| `eventbridge` | `AWS_REGION`, `EVENTS_EVENTBRIDGE_BUS` | AWS SDK v2 (`Source=apso.domain-events`, `DetailType=event.type`) |

`webhook` is a single configured sink, signed per
[Standard Webhooks](https://www.standardwebhooks.com/) — **not** a multi-subscriber
registry.

### Divergence from TypeScript: no lazy dependency loading

The TS reference lazy-`import()`s broker SDKs so a webhook-only deployment pulls **zero**
broker deps. **Go cannot do this.** Go links every imported package at build time, so
the Kafka and AWS SDK packages are unconditional `go.mod` dependencies and are compiled
into every binary — even a webhook-only one. They are only *invoked* when the matching
destination is activated (the adapter constructor runs only when its name appears in
`EVENTS_DESTINATION`), but they are always *present*. This is an intentional, documented
divergence forced by the language: lazy *loading* (TS) becomes lazy *invocation* (Go).

## At-least-once delivery — consumers MUST dedupe

The relay re-sends to **all** active destinations on every retry. Delivery is
**at-least-once**, so consumers **MUST dedupe on `event.id`**. (Single-destination
deployments — the common case — are unaffected in practice but the same id-dedupe rule
applies.)

## Relay

- `ProcessPending(ctx, limit)` (default limit 50): loads `pending` events ordered by
  `created_at ASC`, delivers each to all destinations, then marks `published`
  (+`published_at`) on success or increments `attempts` on failure, flipping to
  `failed` once `attempts >= 5` (`MaxAttempts`).
- The poller drains on a default 5s interval until `Handle.Stop()`.

## Tests

`go test ./...` includes the mandatory Standard Webhooks official vector
(`TestSignWebhook_OfficialVector`), factory selection (unknown → error), mapper
defaults, and capture/relay integration against an in-memory SQLite DB
(pure-Go `glebarez/sqlite`, no cgo).
