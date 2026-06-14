import { createHmac } from 'crypto';
import { DomainEvent } from '../domain-event.entity';
import { DeliveryDestination } from './delivery-destination';

/**
 * Computes a Standard Webhooks (https://www.standardwebhooks.com/) signature.
 *
 * Pure & deterministic: given the same id, timestamp, body and secret it always
 * returns the same `v1,<base64>` signature header value. Extracted so it can be
 * unit-tested in isolation from the HTTP transport.
 *
 * @param id        The webhook message id (here: the DomainEvent id).
 * @param timestamp Unix timestamp in SECONDS.
 * @param body      The exact request body string that will be POSTed.
 * @param secret    The signing secret, in `whsec_<base64>` form.
 */
export function signWebhook(
  id: string,
  timestamp: number,
  body: string,
  secret: string,
): string {
  const signedContent = `${id}.${timestamp}.${body}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');
  return `v1,${signature}`;
}

/**
 * WebhookDestination POSTs each domain event to a SINGLE configured URL,
 * HMAC-signed in the Standard Webhooks format. It is deliberately not a
 * registry: fan-out to multiple subscribers is an application concern, not a
 * library one. Reliability comes from the relay's retry loop — this adapter just
 * throws on any non-2xx response.
 *
 * Uses native `fetch` and node `crypto`, so a webhook-only deployment needs zero
 * extra dependencies.
 *
 * Env:
 *   EVENTS_WEBHOOK_URL    — the single sink URL (required)
 *   EVENTS_WEBHOOK_SECRET — signing secret as `whsec_<base64>` (required)
 */
export class WebhookDestination implements DeliveryDestination {
  readonly name = 'webhook';

  async send(event: DomainEvent): Promise<void> {
    const url = process.env.EVENTS_WEBHOOK_URL;
    const secret = process.env.EVENTS_WEBHOOK_SECRET;
    if (!url) {
      throw new Error('EVENTS_WEBHOOK_URL is not set');
    }
    if (!secret) {
      throw new Error('EVENTS_WEBHOOK_SECRET is not set');
    }

    const id = event.id;
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(event);
    const signature = signWebhook(id, timestamp, body, secret);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': signature,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(
        `Webhook delivery to ${url} failed with status ${response.status}`,
      );
    }
  }
}
