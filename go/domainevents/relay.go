package domainevents

import (
	"context"
	"time"

	"gorm.io/gorm"
)

// DefaultPollInterval is the poller's default drain cadence.
const DefaultPollInterval = 5 * time.Second

// DefaultProcessLimit is the default batch size for ProcessPending.
const DefaultProcessLimit = 50

// Relay drains pending DomainEvent rows and fans them out to the active destinations.
type Relay struct {
	db           *gorm.DB
	destinations []DeliveryDestination
}

// NewRelay constructs a relay over the given DB and destinations.
func NewRelay(db *gorm.DB, destinations []DeliveryDestination) *Relay {
	return &Relay{db: db, destinations: destinations}
}

// ProcessPending loads up to `limit` pending events ordered by created_at ASC and
// delivers each to ALL active destinations. On full success the event is marked
// published; on any failure attempts is incremented and the event is marked failed
// once attempts >= MaxAttempts.
//
// Fan-out is at-least-once: on retry the event is re-sent to ALL destinations, so
// consumers MUST dedupe on event.ID.
func (r *Relay) ProcessPending(ctx context.Context, limit int) error {
	if limit <= 0 {
		limit = DefaultProcessLimit
	}
	// No destinations configured → nothing to do.
	if len(r.destinations) == 0 {
		return nil
	}

	var events []DomainEvent
	if err := r.db.WithContext(ctx).
		Where("status = ?", StatusPending).
		Order("created_at ASC").
		Limit(limit).
		Find(&events).Error; err != nil {
		return err
	}

	for i := range events {
		ev := &events[i]
		if err := r.deliver(ctx, ev); err != nil {
			r.markFailure(ctx, ev)
			continue
		}
		r.markPublished(ctx, ev)
	}
	return nil
}

// deliver sends an event to every active destination, returning the first error.
func (r *Relay) deliver(ctx context.Context, ev *DomainEvent) error {
	for _, d := range r.destinations {
		if err := d.Send(ctx, ev); err != nil {
			return err
		}
	}
	return nil
}

// markPublished sets status=published and published_at=now.
func (r *Relay) markPublished(ctx context.Context, ev *DomainEvent) {
	now := time.Now().UTC()
	ev.Status = StatusPublished
	ev.PublishedAt = &now
	r.db.WithContext(ctx).Model(&DomainEvent{}).
		Where("id = ?", ev.ID).
		Updates(map[string]any{
			"status":       StatusPublished,
			"published_at": now,
		})
}

// markFailure increments attempts and flips status to failed once attempts >= MaxAttempts.
func (r *Relay) markFailure(ctx context.Context, ev *DomainEvent) {
	ev.Attempts++
	updates := map[string]any{"attempts": ev.Attempts}
	if ev.Attempts >= MaxAttempts {
		ev.Status = StatusFailed
		updates["status"] = StatusFailed
	}
	r.db.WithContext(ctx).Model(&DomainEvent{}).
		Where("id = ?", ev.ID).
		Updates(updates)
}

// poller periodically calls ProcessPending until its context is cancelled.
type poller struct {
	relay    *Relay
	interval time.Duration
	limit    int
	cancel   context.CancelFunc
	done     chan struct{}
}

// start launches the poller goroutine.
func (p *poller) start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	p.cancel = cancel
	p.done = make(chan struct{})
	go func() {
		defer close(p.done)
		ticker := time.NewTicker(p.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// Best-effort: errors are swallowed; failures are recorded per-event.
				_ = p.relay.ProcessPending(ctx, p.limit)
			}
		}
	}()
}

// stop cancels the poller and waits for the goroutine to exit.
func (p *poller) stop() {
	if p.cancel != nil {
		p.cancel()
	}
	if p.done != nil {
		<-p.done
	}
}
