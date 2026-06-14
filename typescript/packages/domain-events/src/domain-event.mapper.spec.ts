import { DefaultDomainEventMapper } from './domain-event.mapper';

describe('DefaultDomainEventMapper', () => {
  const mapper = new DefaultDomainEventMapper();

  it('lower-camel-cases the entity name in the event type', () => {
    expect(mapper.eventType('Product', 'created')).toBe('product.created');
    expect(mapper.eventType('OrderLine', 'updated')).toBe('orderLine.updated');
    expect(mapper.eventType('product', 'removed')).toBe('product.removed');
  });

  it('returns a shallow copy of the entity as the payload', () => {
    const entity = { id: 1, name: 'x' };
    const payload = mapper.toPayload(entity, 'created');
    expect(payload).toEqual({ id: 1, name: 'x' });
    expect(payload).not.toBe(entity);
  });
});
