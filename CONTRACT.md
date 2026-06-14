# domain-events — cross-language contract

Every language implementation (`typescript/`, `python/`, `go/`) MUST implement this same behavior so the `domain-events` skill can wire any of them identically. TypeScript is the reference; Python and Go mirror it.

This is the standard **transactional outbox** pattern, surfaced with generic "domain event" naming. No public artifact is named "outbox".

## Layers

```
state change ─(same DB txn)→ DomainEvent row (capture)
                                   │
                       relay drains pending rows (poller)
                                   │
                       fan out to active destination(s) (delivery)
```

## 1. The `DomainEvent` model — table `events`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID, primary key, generated | Stable; consumers dedupe on it |
| `type` | string | e.g. `product.created` |
| `payload` | JSON / JSONB | serialized event payload |
| `status` | enum-or-string: `pending` \| `published` \| `failed` | default `pending` |
| `attempts` | int | default `0` |
| `created_at` | timestamp **with time zone** | set on insert |
| `published_at` | timestamptz, **nullable** | set when delivered |

Index on `(status, created_at)` for relay polling.

## 2. Capture — same-transaction write

On **insert / update / delete** of an **opted-in** entity, write a `DomainEvent` row **inside the same transaction** as the state change, using the framework's transactional hook:
- **TypeScript / TypeORM:** an `@EventSubscriber()` using `event.manager` in `afterInsert`/`afterUpdate`/`afterRemove`.
- **Python / SQLAlchemy:** a session event — `before_flush` (or `SessionEvents`) writing into the same session/unit of work. NOT `after_commit`.
- **Go / GORM:** GORM hooks (`AfterCreate`/`AfterUpdate`/`AfterDelete`) or a registered callback, writing with the hook's transaction handle (`tx *gorm.DB`).

Rules:
- **Recursion guard:** never emit for the `DomainEvent` model itself.
- **Scope:** only opted-in entities emit. The opted-in set is passed in at wiring time (see §7), NOT hardcoded.
- `action` ∈ `created` | `updated` | `removed`.

## 3. Mapper — the extension point (keeps app semantics out)

Interface with two methods (provide a default impl; app can override):
- `eventType(entityName, action) -> string` — default: `"{lowerCamel(entityName)}.{action}"` (e.g. `("Product","created") -> "product.created"`).
- `toPayload(entity, action) -> object` — default: the entity serialized as-is (shallow).

## 4. Relay + self-contained poller

- `processPending(limit = 50)`: load `events` where `status = 'pending'` ordered by `created_at` ASC, limit; for each, deliver to the active destinations; on success set `status='published'`, `published_at = now`; on failure increment `attempts` and set `status='failed'` once `attempts >= MAX_ATTEMPTS` (**5**).
- **Self-contained poller:** the library starts a periodic drain on app startup and stops it on shutdown, using the language's native primitives (TS: `setInterval` in `onApplicationBootstrap`/`onModuleDestroy`; Python: an asyncio background task / startup+shutdown hooks; Go: a goroutine + `context` cancellation). **Do NOT depend on an external scheduler package** (no `@nestjs/schedule`, etc.). Default interval ~5000ms, configurable.

## 5. Delivery destinations — runtime-selected, lazy deps

Active destination(s) are chosen ENTIRELY at runtime from the `EVENTS_DESTINATION` env var (comma-separated → fan-out). There is no build-time/config selection. A factory maps each name to its adapter; an unknown value is a startup error.

Adapters (implement all four):
| name | env | dependency |
|---|---|---|
| `webhook` | `EVENTS_WEBHOOK_URL`, `EVENTS_WEBHOOK_SECRET` | none (native HTTP + crypto) |
| `kafka` | `EVENTS_KAFKA_BROKERS`, `EVENTS_KAFKA_TOPIC` | native kafka client, **lazy/optional** |
| `sqs` | `AWS_REGION`, `EVENTS_SQS_QUEUE_URL` | AWS SDK, **lazy/optional** |
| `eventbridge` | `AWS_REGION`, `EVENTS_EVENTBRIDGE_BUS` | AWS SDK, **lazy/optional**; `Source='apso.domain-events'`, `DetailType=event.type` |

- Each adapter is pure transport: takes a `DomainEvent`, pushes to one sink, **throws on failure** so the relay retries.
- Broker SDKs MUST be loaded lazily (only required when that destination is actually activated) so a webhook-only deployment needs zero broker deps. A missing dep → clear "install X" error.
- **Fan-out is at-least-once and re-sends to ALL destinations on retry → consumers MUST dedupe on `event.id`.** Document this prominently. (Single destination — the common case — is unaffected.)
- **webhook is a single configured sink, NOT a multi-subscriber registry.** No `WebhookEndpoint`/subscriptions table.

## 6. Standard Webhooks signing (webhook adapter)

Per https://www.standardwebhooks.com/:
- `id = event.id`; `timestamp = unix seconds`; `body = JSON(event)`.
- `signedContent = "{id}.{timestamp}.{body}"`.
- `secretBytes = base64_decode(secret without the "whsec_" prefix)`.
- `signature = base64( HMAC_SHA256(signedContent, secretBytes) )`.
- Headers: `webhook-id`, `webhook-timestamp`, `webhook-signature: "v1,{signature}"`, `content-type: application/json`. POST `body`; non-2xx → throw.

**MANDATORY unit test — official vector (every language):**
```
id        = "msg_p5jXN8AQM9LWM0D4loKWxJek"
timestamp = 1614265330
payload   = {"test": 2432232314}      (exact bytes: {"test": 2432232314})
secret    = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
=> signature header value == "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
```

## 7. Public wiring API + the CLI manifest

`.apsorc` `emitEvents` is the *signal*. The CLI emits a **manifest** = the list of opted-in entities. The library consumes that list at wiring time:
- **TS:** `DomainEventsModule.forRoot({ entities: EVENT_EMITTING_ENTITIES, mapper?, pollIntervalMs? })`.
- **Python:** `register_domain_events(app/engine, entities=[...], mapper=None, poll_interval=5.0)`.
- **Go:** `domainevents.Register(db, domainevents.Options{ Entities: []any{...}, Mapper: ..., PollInterval: ... })`.

The skill installs the pinned library and inserts this wiring referencing the generated manifest. The library never hardcodes the entity set.

## 8. Per-language packaging

- **TypeScript:** `typescript/packages/domain-events`, published as `@apso/domain-events`. NestJS + TypeORM peer deps.
- **Python:** `python/packages/domain-events`, distribution `apso-domain-events`. SQLAlchemy (+ optional FastAPI integration).
- **Go:** `go/domainevents`, module `github.com/apsoai/apso-packages/go/domainevents`. GORM.

Each subtree owns its own toolchain, tests, and CI workflow (`.github/workflows/{ts,python,go}.yml`).
