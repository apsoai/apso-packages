import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * DomainEvent is a durable, append-only log of domain state changes.
 *
 * Rows are written in the SAME database transaction as the state change that
 * produced them (see {@link DomainEventSubscriber}), which is what makes
 * delivery durable. This implements the standard "transactional outbox"
 * pattern, but is surfaced with generic domain-event naming — no public
 * artifact is named "outbox".
 *
 * A separate {@link DomainEventRelay} polls pending rows and delivers them.
 * Because the stable `id` is preserved across delivery attempts, consumers can
 * dedupe on it for at-least-once delivery semantics.
 */
@Index(['status', 'created_at'])
@Entity('events')
export class DomainEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Event type, e.g. "product.created". */
  @Column({ type: 'varchar' })
  type!: string;

  /** Serialized event payload. */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  /** Delivery lifecycle: pending -> published, or failed after max attempts. */
  @Column({ type: 'varchar', default: 'pending' })
  status!: 'pending' | 'published' | 'failed';

  /** Number of delivery attempts made by the relay. */
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  /** When the event was successfully published; null until then. */
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
