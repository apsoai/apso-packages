// Simulate a deployment that did NOT install the optional broker SDKs. A
// throwing jest.mock factory makes `require(pkg)` throw exactly as Node does
// when the module is absent, so we can assert the adapter's clear install
// error. CONTRACT.md §5: missing dep → clear "install X" error.

const moduleNotFound = (name: string) => {
  const err = new Error(`Cannot find module '${name}'`) as Error & {
    code?: string;
  };
  err.code = 'MODULE_NOT_FOUND';
  throw err;
};

jest.mock(
  '@aws-sdk/client-sqs',
  () => moduleNotFound('@aws-sdk/client-sqs'),
  { virtual: true },
);
jest.mock(
  '@aws-sdk/client-eventbridge',
  () => moduleNotFound('@aws-sdk/client-eventbridge'),
  { virtual: true },
);
jest.mock(
  '@nestjs/microservices',
  () => moduleNotFound('@nestjs/microservices'),
  { virtual: true },
);

import { KafkaDestination } from './kafka.destination';
import { SqsDestination } from './sqs.destination';
import { EventBridgeDestination } from './eventbridge.destination';

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV };
});

afterEach(() => {
  process.env = OLD_ENV;
});

const event = {
  id: 'e',
  type: 't',
  payload: {},
  status: 'pending' as const,
  attempts: 0,
  created_at: new Date(),
  publishedAt: null,
};

describe('lazy broker adapters — clear install error when SDK is missing', () => {
  it('kafka surfaces a clear install error', async () => {
    process.env.EVENTS_KAFKA_TOPIC = 'topic';
    process.env.EVENTS_KAFKA_BROKERS = 'localhost:9092';
    await expect(new KafkaDestination().send(event)).rejects.toThrow(
      /npm install @nestjs\/microservices kafkajs rxjs/,
    );
  });

  it('sqs surfaces a clear install error', async () => {
    process.env.EVENTS_SQS_QUEUE_URL = 'https://sqs/q';
    await expect(new SqsDestination().send(event)).rejects.toThrow(
      /npm install @aws-sdk\/client-sqs/,
    );
  });

  it('eventbridge surfaces a clear install error', async () => {
    process.env.EVENTS_EVENTBRIDGE_BUS = 'bus';
    await expect(new EventBridgeDestination().send(event)).rejects.toThrow(
      /npm install @aws-sdk\/client-eventbridge/,
    );
  });
});
