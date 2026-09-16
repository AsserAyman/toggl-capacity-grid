package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestUpdatePersonValidation(t *testing.T) {
	s := &server{} // no database: every case must be rejected before a query runs
	tests := []struct {
		name, path, body, wantErr string
	}{
		{"non-numeric id", "/api/people/abc", `{"weekly_hours": 32}`, "positive integer"},
		{"zero id", "/api/people/0", `{"weekly_hours": 32}`, "positive integer"},
		{"invalid json", "/api/people/1", `{"weekly_hours":`, "invalid body"},
		{"unknown field", "/api/people/1", `{"hours": 32}`, "unknown field"},
		{"missing weekly_hours", "/api/people/1", `{}`, "required"},
		{"null weekly_hours", "/api/people/1", `{"weekly_hours": null}`, "required"},
		{"string weekly_hours", "/api/people/1", `{"weekly_hours": "32"}`, "invalid body"},
		{"negative", "/api/people/1", `{"weekly_hours": -1}`, "between 0 and 168"},
		{"more than a week", "/api/people/1", `{"weekly_hours": 168.5}`, "between 0 and 168"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, s, http.MethodPatch, tt.path, tt.body)
			assertStatus(t, rec, http.StatusBadRequest)
			if body := decode[map[string]string](t, rec); !strings.Contains(body["error"], tt.wantErr) {
				t.Errorf("error = %q, want containing %q", body["error"], tt.wantErr)
			}
		})
	}
}

func TestUpdatePersonNotFound(t *testing.T) {
	s := testServer(t)
	rec := do(t, s, http.MethodPatch, "/api/people/999999", `{"weekly_hours": 10}`)
	assertStatus(t, rec, http.StatusNotFound)
}

// The brief's requirement: after an edit, every number that depends on the
// person is right. Capacity follows the new hours in every week of the range;
// allocation doesn't move.
func TestUpdatePersonIsReflectedInCapacity(t *testing.T) {
	s := testServer(t)
	const dee = 4

	var original float64
	if err := s.db.QueryRow(context.Background(),
		`SELECT weekly_hours::float8 FROM people WHERE id = $1`, dee).Scan(&original); err != nil {
		t.Fatalf("read original hours: %v", err)
	}
	t.Cleanup(func() {
		if _, err := s.db.Exec(context.Background(),
			`UPDATE people SET weekly_hours = $1 WHERE id = $2`, original, dee); err != nil {
			t.Errorf("restore weekly_hours for person %d to %v: %v", dee, original, err)
		}
	})

	rec := do(t, s, http.MethodPatch, "/api/people/4", `{"weekly_hours": 37.5}`)
	assertStatus(t, rec, http.StatusOK)
	if got := decode[person](t, rec); got != (person{ID: dee, Name: "Dee Okafor", WeeklyHours: 37.5}) {
		t.Errorf("PATCH returned %+v", got)
	}

	rec = do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-16", "")
	assertStatus(t, rec, http.StatusOK)
	for _, p := range decode[capacityResponse](t, rec).People {
		if p.ID != dee {
			continue
		}
		if p.WeeklyHours != 37.5 {
			t.Errorf("weekly_hours = %v, want 37.5", p.WeeklyHours)
		}
		wantAllocated := []float64{0, 45, 40}
		for i, cell := range p.Weeks {
			if cell.Capacity != 37.5 || cell.Allocated != wantAllocated[i] {
				t.Errorf("week %d: got %v/%v, want %v/37.5", i, cell.Allocated, cell.Capacity, wantAllocated[i])
			}
		}
		return
	}
	t.Fatalf("person %d missing from capacity response", dee)
}
