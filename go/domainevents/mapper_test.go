package domainevents

import (
	"encoding/json"
	"testing"
)

func TestDefaultMapper_EventType(t *testing.T) {
	m := DefaultMapper{}
	cases := []struct {
		entity, action, want string
	}{
		{"Product", "created", "product.created"},
		{"OrderItem", "updated", "orderItem.updated"},
		{"User", "removed", "user.removed"},
	}
	for _, c := range cases {
		if got := m.EventType(c.entity, c.action); got != c.want {
			t.Errorf("EventType(%q,%q) = %q, want %q", c.entity, c.action, got, c.want)
		}
	}
}

func TestLowerCamel(t *testing.T) {
	cases := map[string]string{
		"":          "",
		"Product":   "product",
		"OrderItem": "orderItem",
		"X":         "x",
	}
	for in, want := range cases {
		if got := lowerCamel(in); got != want {
			t.Errorf("lowerCamel(%q) = %q, want %q", in, got, want)
		}
	}
}

type sampleEntity struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func TestDefaultMapper_ToPayload(t *testing.T) {
	m := DefaultMapper{}
	e := sampleEntity{ID: 7, Name: "widget"}
	got := m.ToPayload(e, "created")
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	if string(raw) != `{"id":7,"name":"widget"}` {
		t.Fatalf("unexpected payload: %s", raw)
	}
}

func TestBuildEvent(t *testing.T) {
	ev, err := buildEvent(DefaultMapper{}, "Product", "created", sampleEntity{ID: 1, Name: "p"})
	if err != nil {
		t.Fatalf("buildEvent error: %v", err)
	}
	if ev.Type != "product.created" {
		t.Errorf("Type = %q, want product.created", ev.Type)
	}
	if ev.Status != StatusPending {
		t.Errorf("Status = %q, want pending", ev.Status)
	}
	if string(ev.Payload) != `{"id":1,"name":"p"}` {
		t.Errorf("Payload = %s", ev.Payload)
	}
}

func TestEntityName(t *testing.T) {
	if got := entityName(sampleEntity{}); got != "sampleEntity" {
		t.Errorf("entityName(value) = %q", got)
	}
	if got := entityName(&sampleEntity{}); got != "sampleEntity" {
		t.Errorf("entityName(ptr) = %q", got)
	}
}
