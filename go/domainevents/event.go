package domainevents

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Event status constants.
const (
	StatusPending   = "pending"
	StatusPublished = "published"
	StatusFailed    = "failed"
)

// Action constants for capture.
const (
	ActionCreated = "created"
	ActionUpdated = "updated"
	ActionRemoved = "removed"
)

// MaxAttempts is the number of delivery attempts before an event is marked failed.
const MaxAttempts = 5

// DomainEvent is the transactional outbox row written in the same transaction as the
// originating state change. It maps to the `events` table.
type DomainEvent struct {
	// ID is a generated UUID primary key. Consumers dedupe on it.
	ID string `gorm:"type:uuid;primaryKey" json:"id"`
	// Type is the event type, e.g. "product.created".
	Type string `gorm:"column:type;not null" json:"type"`
	// Payload is the serialized event payload (JSON/JSONB).
	Payload datatypes.JSON `gorm:"column:payload;type:jsonb" json:"payload"`
	// Status is one of pending | published | failed.
	Status string `gorm:"column:status;not null;default:pending;index:idx_events_status_created_at,priority:1" json:"status"`
	// Attempts counts delivery attempts.
	Attempts int `gorm:"column:attempts;not null;default:0" json:"attempts"`
	// CreatedAt is set on insert.
	CreatedAt time.Time `gorm:"column:created_at;not null;index:idx_events_status_created_at,priority:2" json:"createdAt"`
	// PublishedAt is set when delivered; nil until then.
	PublishedAt *time.Time `gorm:"column:published_at" json:"publishedAt,omitempty"`
}

// TableName overrides the GORM table name to `events`.
func (DomainEvent) TableName() string {
	return "events"
}

// BeforeCreate ensures an ID and CreatedAt are populated before insert.
func (e *DomainEvent) BeforeCreate(tx *gorm.DB) error {
	if e.ID == "" {
		e.ID = uuid.NewString()
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	if e.Status == "" {
		e.Status = StatusPending
	}
	return nil
}
