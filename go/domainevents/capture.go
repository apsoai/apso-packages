package domainevents

import (
	"encoding/json"
	"reflect"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// capturer registers GORM callbacks that write a DomainEvent in the same transaction
// as the originating state change, for opted-in entities only.
type capturer struct {
	mapper  Mapper
	optedIn map[reflect.Type]struct{}
	dmType  reflect.Type
}

// newCapturer builds a capturer for the given opted-in entities.
func newCapturer(mapper Mapper, entities []any) *capturer {
	c := &capturer{
		mapper:  mapper,
		optedIn: make(map[reflect.Type]struct{}),
		dmType:  reflect.TypeOf(DomainEvent{}),
	}
	for _, e := range entities {
		if t := baseType(reflect.TypeOf(e)); t != nil {
			c.optedIn[t] = struct{}{}
		}
	}
	return c
}

// register attaches AfterCreate/AfterUpdate/AfterDelete callbacks to the DB.
func (c *capturer) register(db *gorm.DB) error {
	cb := db.Callback()
	if err := cb.Create().After("gorm:create").Register("domainevents:after_create", c.after(ActionCreated)); err != nil {
		return err
	}
	if err := cb.Update().After("gorm:update").Register("domainevents:after_update", c.after(ActionUpdated)); err != nil {
		return err
	}
	if err := cb.Delete().After("gorm:delete").Register("domainevents:after_delete", c.after(ActionRemoved)); err != nil {
		return err
	}
	return nil
}

// after returns a GORM callback for the given action.
func (c *capturer) after(action string) func(*gorm.DB) {
	return func(tx *gorm.DB) {
		if tx.Error != nil || tx.Statement == nil || tx.Statement.Schema == nil {
			return
		}
		model := tx.Statement.Model
		if model == nil {
			return
		}
		mt := baseType(reflect.TypeOf(model))
		if mt == nil {
			return
		}
		// Recursion guard: never emit for the DomainEvent model itself.
		if mt == c.dmType {
			return
		}
		// Scope: only opted-in entities emit.
		if _, ok := c.optedIn[mt]; !ok {
			return
		}

		name := mt.Name()
		// Statement.ReflectValue may be a slice (batch) or a struct. Handle both.
		rv := tx.Statement.ReflectValue
		switch rv.Kind() {
		case reflect.Slice, reflect.Array:
			for i := 0; i < rv.Len(); i++ {
				c.emit(tx, name, action, rv.Index(i).Interface())
			}
		default:
			if rv.IsValid() && rv.CanInterface() {
				c.emit(tx, name, action, rv.Interface())
			}
		}
	}
}

// emit builds and writes a DomainEvent using the callback's transaction handle.
func (c *capturer) emit(tx *gorm.DB, name, action string, entity any) {
	ev, err := buildEvent(c.mapper, name, action, entity)
	if err != nil {
		_ = tx.AddError(err)
		return
	}
	// Write within the same transaction (tx.Statement.ConnPool is the active txn).
	// NewDB:true gives a clean *gorm.DB whose Statement is not the in-flight one,
	// while still using tx's connection pool so the insert joins the same txn.
	// The recursion guard in after() prevents this insert from re-emitting.
	if err := tx.Session(&gorm.Session{NewDB: true}).Create(ev).Error; err != nil {
		_ = tx.AddError(err)
	}
}

// buildEvent constructs a DomainEvent (without persisting) from entity + action.
// Exposed package-internally so it can be unit-tested without a DB.
func buildEvent(mapper Mapper, name, action string, entity any) (*DomainEvent, error) {
	payload := mapper.ToPayload(entity, action)
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return &DomainEvent{
		Type:    mapper.EventType(name, action),
		Payload: datatypes.JSON(raw),
		Status:  StatusPending,
	}, nil
}

// baseType dereferences pointer/slice types down to the underlying struct type.
func baseType(t reflect.Type) reflect.Type {
	for t != nil {
		switch t.Kind() {
		case reflect.Ptr, reflect.Slice, reflect.Array:
			t = t.Elem()
		default:
			if t.Kind() == reflect.Struct {
				return t
			}
			return nil
		}
	}
	return nil
}
