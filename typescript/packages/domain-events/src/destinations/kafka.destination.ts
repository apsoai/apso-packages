import { DomainEvent } from '../domain-event.entity';
import { DeliveryDestination } from './delivery-destination';

/**
 * KafkaDestination emits each domain event onto a Kafka topic using the
 * idiomatic `@nestjs/microservices` ClientProxy.
 *
 * `@nestjs/microservices`, `kafkajs` and `rxjs` are loaded LAZILY (require) so
 * they are only needed when this destination is actually activated at runtime
 * (EVENTS_DESTINATION=kafka). Install them in the deploying service:
 * `npm install @nestjs/microservices kafkajs rxjs`.
 *
 * Env:
 *   EVENTS_KAFKA_BROKERS — comma-separated broker list (required)
 *   EVENTS_KAFKA_TOPIC   — topic to emit to (required)
 */
export class KafkaDestination implements DeliveryDestination {
  readonly name = 'kafka';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client?: any;
  private connected = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private loadDep(pkg: string): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      return require(pkg);
    } catch {
      throw new Error(
        "EVENTS_DESTINATION=kafka requires '@nestjs/microservices', 'kafkajs' " +
          "and 'rxjs' — run `npm install @nestjs/microservices kafkajs rxjs`",
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getClient(): any {
    if (!this.client) {
      const brokers = (process.env.EVENTS_KAFKA_BROKERS ?? '')
        .split(',')
        .map((broker) => broker.trim())
        .filter(Boolean);
      if (brokers.length === 0) {
        throw new Error('EVENTS_KAFKA_BROKERS is not set');
      }
      const { ClientProxyFactory, Transport } = this.loadDep(
        '@nestjs/microservices',
      );
      this.client = ClientProxyFactory.create({
        transport: Transport.KAFKA,
        options: { client: { brokers } },
      });
    }
    return this.client;
  }

  async send(event: DomainEvent): Promise<void> {
    if (!process.env.EVENTS_KAFKA_TOPIC) {
      throw new Error('EVENTS_KAFKA_TOPIC is not set');
    }
    const topic = process.env.EVENTS_KAFKA_TOPIC;
    const { lastValueFrom } = this.loadDep('rxjs');
    const client = this.getClient();
    if (!this.connected) {
      await client.connect();
      this.connected = true;
    }
    await lastValueFrom(client.emit(topic, event));
  }
}
