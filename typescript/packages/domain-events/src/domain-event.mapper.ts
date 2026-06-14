import { Injectable } from '@nestjs/common';

/**
 * Action that produced a domain event.
 */
export type DomainEventAction = 'created' | 'updated' | 'removed';

/**
 * DI token for the {@link DomainEventMapper}.
 *
 * {@link DomainEventsModule} binds this token to {@link DefaultDomainEventMapper}.
 * Your application can override it by providing its own implementation:
 *
 *   { provide: DOMAIN_EVENT_MAPPER, useClass: MyDomainEventMapper }
 */
export const DOMAIN_EVENT_MAPPER = 'DOMAIN_EVENT_MAPPER';

/**
 * DomainEventMapper is the extension point that keeps application semantics
 * (event-type taxonomy, payload shape) OUT of the library. Provide your own
 * implementation under {@link DOMAIN_EVENT_MAPPER} to customize.
 */
export interface DomainEventMapper {
  /**
   * Maps an entity name + action to an event type string, e.g.
   * ("Product", "created") -> "product.created".
   */
  eventType(entityName: string, action: DomainEventAction): string;

  /**
   * Builds the serializable payload for an event from the changed entity.
   */
  toPayload(entity: unknown, action: DomainEventAction): Record<string, unknown>;
}

/**
 * Default mapper. Uses an `entity.action` type taxonomy (entity name
 * lower-camel-cased) and returns the entity as-is (shallow) as the payload.
 *
 * Override by providing your own {@link DomainEventMapper} under
 * {@link DOMAIN_EVENT_MAPPER}.
 */
@Injectable()
export class DefaultDomainEventMapper implements DomainEventMapper {
  eventType(entityName: string, action: DomainEventAction): string {
    const normalized = entityName
      ? entityName.charAt(0).toLowerCase() + entityName.slice(1)
      : entityName;
    return `${normalized}.${action}`;
  }

  toPayload(
    entity: unknown,
    _action: DomainEventAction,
  ): Record<string, unknown> {
    return { ...(entity as Record<string, unknown>) };
  }
}
