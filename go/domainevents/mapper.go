package domainevents

import (
	"reflect"
	"unicode"
)

// Mapper is the extension point that keeps application semantics out of the library.
// Apps may provide their own implementation; DefaultMapper is used otherwise.
type Mapper interface {
	// EventType maps an entity name + action to an event type string,
	// e.g. ("Product", "created") -> "product.created".
	EventType(entityName, action string) string
	// ToPayload produces the serializable payload for an entity + action.
	// Default is the entity serialized as-is (shallow).
	ToPayload(entity any, action string) any
}

// DefaultMapper implements Mapper with the contract defaults.
type DefaultMapper struct{}

// EventType returns "{lowerCamel(entityName)}.{action}".
func (DefaultMapper) EventType(entityName, action string) string {
	return lowerCamel(entityName) + "." + action
}

// ToPayload returns the entity as-is for serialization.
func (DefaultMapper) ToPayload(entity any, action string) any {
	return entity
}

// lowerCamel lower-cases the first rune of s, leaving the rest untouched.
// e.g. "Product" -> "product", "OrderItem" -> "orderItem".
func lowerCamel(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = unicode.ToLower(r[0])
	return string(r)
}

// entityName derives a stable name for an entity value, used by the default mapper.
// It dereferences pointers and returns the Go type name.
func entityName(entity any) string {
	t := reflect.TypeOf(entity)
	for t != nil && t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	if t == nil {
		return ""
	}
	return t.Name()
}
