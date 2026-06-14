// Package domainevents implements the transactional outbox pattern for GORM/Gin
// applications. State changes to opted-in entities write a DomainEvent row in the
// same transaction (capture); a self-contained poller drains pending rows (relay)
// and fans them out to runtime-selected destinations (delivery).
//
// See CONTRACT.md for the cross-language behavior this mirrors.
package domainevents

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// Options configures Register.
type Options struct {
	// Entities is the opted-in set; only these emit events. Pass instances or
	// pointers, e.g. []any{Product{}, &Order{}}.
	Entities []any
	// Mapper customizes event type / payload. Defaults to DefaultMapper.
	Mapper Mapper
	// PollInterval is the relay drain cadence. Defaults to DefaultPollInterval (5s).
	PollInterval time.Duration
	// ProcessLimit is the per-drain batch size. Defaults to DefaultProcessLimit (50).
	ProcessLimit int
	// AutoMigrate, when true, runs db.AutoMigrate(&DomainEvent{}) during Register.
	AutoMigrate bool
}

// Handle is returned by Register; call Stop to shut the poller down cleanly.
type Handle struct {
	poller *poller
	Relay  *Relay
}

// Stop cancels the poller and waits for it to exit. Safe to call once.
func (h *Handle) Stop() {
	if h != nil && h.poller != nil {
		h.poller.stop()
	}
}

// Register wires capture callbacks onto db and starts the relay poller. The active
// delivery destinations are resolved from EVENTS_DESTINATION at this point; an
// unknown value is returned as an error.
func Register(db *gorm.DB, opts Options) (*Handle, error) {
	if db == nil {
		return nil, fmt.Errorf("domainevents: Register requires a non-nil *gorm.DB")
	}

	mapper := opts.Mapper
	if mapper == nil {
		mapper = DefaultMapper{}
	}

	if opts.AutoMigrate {
		if err := db.AutoMigrate(&DomainEvent{}); err != nil {
			return nil, fmt.Errorf("domainevents: auto-migrate failed: %w", err)
		}
	}

	// Register same-transaction capture callbacks for opted-in entities.
	cptr := newCapturer(mapper, opts.Entities)
	if err := cptr.register(db); err != nil {
		return nil, fmt.Errorf("domainevents: failed to register callbacks: %w", err)
	}

	// Resolve delivery destinations from the environment.
	dests, err := resolveDestinations()
	if err != nil {
		return nil, err
	}

	interval := opts.PollInterval
	if interval <= 0 {
		interval = DefaultPollInterval
	}
	limit := opts.ProcessLimit
	if limit <= 0 {
		limit = DefaultProcessLimit
	}

	relay := NewRelay(db, dests)
	p := &poller{relay: relay, interval: interval, limit: limit}
	p.start(context.Background())

	return &Handle{poller: p, Relay: relay}, nil
}
