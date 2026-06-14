package domainevents

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// captureProduct is an opted-in entity for capture tests.
type captureProduct struct {
	ID   uint `gorm:"primaryKey"`
	Name string
}

// captureIgnored is NOT opted in; it must never emit an event.
type captureIgnored struct {
	ID uint `gorm:"primaryKey"`
}

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	// Each test gets its own isolated in-memory database. A shared-cache DSN
	// keyed by the test name keeps the DB alive across this test's connections
	// while preventing cross-test row pollution (a single global
	// "file::memory:?cache=shared" DSN is shared process-wide).
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&DomainEvent{}, &captureProduct{}, &captureIgnored{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func countEvents(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&DomainEvent{}).Count(&n).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestCapture_CreateUpdateDelete(t *testing.T) {
	db := newTestDB(t)
	c := newCapturer(DefaultMapper{}, []any{captureProduct{}})
	if err := c.register(db); err != nil {
		t.Fatalf("register: %v", err)
	}

	p := &captureProduct{Name: "widget"}
	if err := db.Create(p).Error; err != nil {
		t.Fatalf("create: %v", err)
	}
	if got := countEvents(t, db); got != 1 {
		t.Fatalf("after create: want 1 event, got %d", got)
	}

	p.Name = "gadget"
	if err := db.Save(p).Error; err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := countEvents(t, db); got != 2 {
		t.Fatalf("after update: want 2 events, got %d", got)
	}

	if err := db.Delete(p).Error; err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := countEvents(t, db); got != 3 {
		t.Fatalf("after delete: want 3 events, got %d", got)
	}

	var first DomainEvent
	if err := db.Order("created_at ASC").First(&first).Error; err != nil {
		t.Fatalf("load first event: %v", err)
	}
	if first.Type != "captureProduct.created" {
		t.Errorf("first event type = %q, want captureProduct.created", first.Type)
	}
	if first.Status != StatusPending {
		t.Errorf("first event status = %q, want pending", first.Status)
	}
}

func TestCapture_OnlyOptedIn(t *testing.T) {
	db := newTestDB(t)
	c := newCapturer(DefaultMapper{}, []any{captureProduct{}})
	if err := c.register(db); err != nil {
		t.Fatalf("register: %v", err)
	}

	if err := db.Create(&captureIgnored{}).Error; err != nil {
		t.Fatalf("create ignored: %v", err)
	}
	if got := countEvents(t, db); got != 0 {
		t.Fatalf("ignored entity emitted %d events, want 0", got)
	}
}

func TestCapture_RecursionGuard(t *testing.T) {
	db := newTestDB(t)
	// Opt in DomainEvent itself — the guard must still prevent self-emission.
	c := newCapturer(DefaultMapper{}, []any{captureProduct{}, DomainEvent{}})
	if err := c.register(db); err != nil {
		t.Fatalf("register: %v", err)
	}

	if err := db.Create(&captureProduct{Name: "x"}).Error; err != nil {
		t.Fatalf("create: %v", err)
	}
	// Exactly one event: the product's. The DomainEvent insert must not recurse.
	if got := countEvents(t, db); got != 1 {
		t.Fatalf("recursion guard failed: got %d events, want 1", got)
	}
}

// stubDestination records sends and optionally fails.
type stubDestination struct {
	name  string
	fail  bool
	calls int
}

func (s *stubDestination) Name() string { return s.name }
func (s *stubDestination) Send(ctx context.Context, ev *DomainEvent) error {
	s.calls++
	if s.fail {
		return errors.New("stub failure")
	}
	return nil
}

func TestRelay_ProcessPending_Success(t *testing.T) {
	db := newTestDB(t)
	if err := db.Create(&DomainEvent{Type: "product.created", Payload: []byte(`{}`)}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	stub := &stubDestination{name: "stub"}
	relay := NewRelay(db, []DeliveryDestination{stub})
	if err := relay.ProcessPending(context.Background(), 50); err != nil {
		t.Fatalf("ProcessPending: %v", err)
	}
	if stub.calls != 1 {
		t.Errorf("destination calls = %d, want 1", stub.calls)
	}

	var ev DomainEvent
	if err := db.First(&ev).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if ev.Status != StatusPublished {
		t.Errorf("status = %q, want published", ev.Status)
	}
	if ev.PublishedAt == nil {
		t.Error("published_at is nil, want set")
	}
}

func TestRelay_ProcessPending_FailureRetriesThenFails(t *testing.T) {
	db := newTestDB(t)
	if err := db.Create(&DomainEvent{Type: "product.created", Payload: []byte(`{}`)}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	stub := &stubDestination{name: "stub", fail: true}
	relay := NewRelay(db, []DeliveryDestination{stub})

	// Drain MaxAttempts times; each pending drain re-attempts the event.
	for i := 0; i < MaxAttempts; i++ {
		if err := relay.ProcessPending(context.Background(), 50); err != nil {
			t.Fatalf("ProcessPending iter %d: %v", i, err)
		}
	}

	var ev DomainEvent
	if err := db.First(&ev).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if ev.Attempts != MaxAttempts {
		t.Errorf("attempts = %d, want %d", ev.Attempts, MaxAttempts)
	}
	if ev.Status != StatusFailed {
		t.Errorf("status = %q, want failed", ev.Status)
	}
}

func TestRelay_NoDestinations_NoOp(t *testing.T) {
	db := newTestDB(t)
	if err := db.Create(&DomainEvent{Type: "product.created", Payload: []byte(`{}`)}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	relay := NewRelay(db, nil)
	if err := relay.ProcessPending(context.Background(), 50); err != nil {
		t.Fatalf("ProcessPending: %v", err)
	}
	var ev DomainEvent
	if err := db.First(&ev).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	// Still pending — nothing delivered.
	if ev.Status != StatusPending {
		t.Errorf("status = %q, want pending", ev.Status)
	}
}
