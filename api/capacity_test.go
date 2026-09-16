package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestParseWeekRange(t *testing.T) {
	tests := []struct {
		name      string
		from, to  string
		wantFirst string
		wantWeeks int
		wantErr   string
	}{
		{name: "whole weeks", from: "2025-12-29", to: "2026-01-18", wantFirst: "2025-12-29", wantWeeks: 3},
		{name: "mid-week ends widen to whole weeks", from: "2025-12-31", to: "2026-01-14", wantFirst: "2025-12-29", wantWeeks: 3},
		{name: "sunday from belongs to the week before", from: "2026-01-04", to: "2026-01-05", wantFirst: "2025-12-29", wantWeeks: 2},
		{name: "single day", from: "2026-01-07", to: "2026-01-07", wantFirst: "2026-01-05", wantWeeks: 1},
		{name: "year boundary", from: "2026-01-01", to: "2026-01-01", wantFirst: "2025-12-29", wantWeeks: 1},
		{name: "53 weeks is the cap", from: "2026-01-05", to: "2027-01-08", wantFirst: "2026-01-05", wantWeeks: 53},
		{name: "54 weeks is too many", from: "2026-01-05", to: "2027-01-11", wantErr: "more than 53 weeks"},
		{name: "reversed", from: "2026-01-12", to: "2026-01-05", wantErr: "before from"},
		{name: "missing to", from: "2026-01-05", to: "", wantErr: "required"},
		{name: "malformed", from: "05/01/2026", to: "2026-01-05", wantErr: "expected YYYY-MM-DD"},
		{name: "impossible date", from: "2026-02-30", to: "2026-03-05", wantErr: "expected YYYY-MM-DD"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			weeks, err := parseWeekRange(tt.from, tt.to)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(weeks) != tt.wantWeeks {
				t.Fatalf("got %d weeks, want %d", len(weeks), tt.wantWeeks)
			}
			if got := weeks[0].Format(dateLayout); got != tt.wantFirst {
				t.Errorf("first week = %s, want %s", got, tt.wantFirst)
			}
			for i, wk := range weeks {
				if wk.Weekday() != 1 {
					t.Errorf("week %d (%s) is not a Monday", i, wk.Format(dateLayout))
				}
			}
		})
	}
}

func TestCapacityRejectsBadRangeBeforeQuerying(t *testing.T) {
	s := &server{} // no database: validation must fail before any query runs
	rec := do(t, s, http.MethodGet, "/api/capacity?from=2026-01-12&to=2026-01-05", "")
	assertStatus(t, rec, http.StatusBadRequest)
	if body := decode[map[string]string](t, rec); !strings.Contains(body["error"], "before from") {
		t.Errorf("error = %q", body["error"])
	}
}

// People 1–5 are hand-built edge cases in the seed. Their numbers were
// derived by hand from the raw assignments; see .notes/worklog.md.
func TestCapacityReferencePeople(t *testing.T) {
	s := testServer(t)

	rec := do(t, s, http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-16", "")
	assertStatus(t, rec, http.StatusOK)
	resp := decode[capacityResponse](t, rec)

	if resp.From != "2025-12-29" || resp.To != "2026-01-18" {
		t.Errorf("range = %s..%s, want widened to 2025-12-29..2026-01-18", resp.From, resp.To)
	}
	if want := []string{"2025-12-29", "2026-01-05", "2026-01-12"}; strings.Join(resp.Weeks, ",") != strings.Join(want, ",") {
		t.Fatalf("weeks = %v, want %v", resp.Weeks, want)
	}
	if len(resp.People) != 500 {
		t.Errorf("got %d people, want all 500", len(resp.People))
	}
	for _, p := range resp.People {
		if len(p.Weeks) != len(resp.Weeks) {
			t.Fatalf("%s has %d cells, want one per week (%d)", p.Name, len(p.Weeks), len(resp.Weeks))
		}
	}

	tests := []struct {
		id        int
		why       string
		allocated []float64
		capacity  float64
	}{
		{1, "Mon–Sun assignment: weekend days carry no hours (40, not 56)", []float64{40, 0, 30}, 40},
		{2, "Fri→Mon assignment splits across the week boundary", []float64{0, 32, 8}, 40},
		{3, "single-day and part-week assignments", []float64{0, 4, 12}, 20},
		{4, "overlapping assignments sum past capacity, then exactly at it", []float64{0, 45, 40}, 40},
		{5, "hours against zero capacity", []float64{0, 20, 0}, 0},
	}
	byID := make(map[int]personCapacity, len(resp.People))
	for _, p := range resp.People {
		byID[p.ID] = p
	}
	for _, tt := range tests {
		p, ok := byID[tt.id]
		if !ok {
			t.Errorf("person %d missing", tt.id)
			continue
		}
		for i, cell := range p.Weeks {
			if cell.Allocated != tt.allocated[i] || cell.Capacity != tt.capacity {
				t.Errorf("%s, week %s: got %v/%v, want %v/%v (%s)",
					p.Name, resp.Weeks[i], cell.Allocated, cell.Capacity, tt.allocated[i], tt.capacity, tt.why)
			}
		}
	}
}
