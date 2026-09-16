package main

import (
	"fmt"
	"net/http"
	"time"
)

const (
	dateLayout = "2006-01-02"
	// maxWeeks bounds a single request: 500 people × 53 weeks is ~26k cells.
	maxWeeks = 53
)

type capacityResponse struct {
	// From is the Monday of the first week, To the Sunday of the last. The
	// requested range is widened to whole weeks, so these may differ from the
	// query parameters.
	From  string   `json:"from"`
	To    string   `json:"to"`
	Weeks []string `json:"weeks"` // Monday of each week, ascending
	// People is sorted by name. Each person's Weeks lines up index-for-index
	// with the top-level Weeks.
	People []personCapacity `json:"people"`
}

type personCapacity struct {
	ID          int            `json:"id"`
	Name        string         `json:"name"`
	WeeklyHours float64        `json:"weekly_hours"`
	Weeks       []weekCapacity `json:"weeks"`
}

type weekCapacity struct {
	Allocated float64 `json:"allocated"`
	Capacity  float64 `json:"capacity"`
}

// Allocation counts working days only: an assignment contributes
// hours_per_day for each Monday–Friday it overlaps within the week. Weekend
// days inside an assignment's range carry no hours.
//
// Capacity is the person's current weekly_hours for every week; there is no
// history of past values.
const capacityQuery = `
WITH weeks AS (
  SELECT unnest($1::date[]) AS week_start
),
allocated AS (
  SELECT a.person_id,
         w.week_start,
         sum(a.hours_per_day * (
           least(a.end_date, w.week_start + 4) - greatest(a.start_date, w.week_start) + 1
         )) AS hours
  FROM weeks w
  JOIN assignments a
    ON a.start_date <= w.week_start + 4
   AND a.end_date   >= w.week_start
  GROUP BY a.person_id, w.week_start
)
SELECT p.id,
       p.name,
       p.weekly_hours::float8,
       w.week_start,
       coalesce(al.hours, 0)::float8 AS allocated,
       p.weekly_hours::float8        AS capacity
FROM people p
CROSS JOIN weeks w
LEFT JOIN allocated al
  ON al.person_id = p.id
 AND al.week_start = w.week_start
ORDER BY p.name, p.id, w.week_start`

// handleCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	weeks, err := parseWeekRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	rows, err := s.db.Query(r.Context(), capacityQuery, weeks)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query capacity: "+err.Error())
		return
	}
	defer rows.Close()

	resp := capacityResponse{
		From:   weeks[0].Format(dateLayout),
		To:     weeks[len(weeks)-1].AddDate(0, 0, 6).Format(dateLayout),
		Weeks:  make([]string, len(weeks)),
		People: []personCapacity{},
	}
	weekIndex := make(map[string]int, len(weeks))
	for i, wk := range weeks {
		resp.Weeks[i] = wk.Format(dateLayout)
		weekIndex[resp.Weeks[i]] = i
	}

	for rows.Next() {
		var (
			id                  int
			name                string
			weeklyHours         float64
			weekStart           time.Time
			allocated, capacity float64
		)
		if err := rows.Scan(&id, &name, &weeklyHours, &weekStart, &allocated, &capacity); err != nil {
			writeError(w, http.StatusInternalServerError, "scan capacity: "+err.Error())
			return
		}
		if n := len(resp.People); n == 0 || resp.People[n-1].ID != id {
			resp.People = append(resp.People, personCapacity{
				ID:          id,
				Name:        name,
				WeeklyHours: weeklyHours,
				Weeks:       make([]weekCapacity, len(weeks)),
			})
		}
		resp.People[len(resp.People)-1].Weeks[weekIndex[weekStart.Format(dateLayout)]] = weekCapacity{
			Allocated: allocated,
			Capacity:  capacity,
		}
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "read capacity: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// parseWeekRange returns the Monday of every week touched by [from, to].
func parseWeekRange(fromParam, toParam string) ([]time.Time, error) {
	if fromParam == "" || toParam == "" {
		return nil, fmt.Errorf("from and to are required (YYYY-MM-DD)")
	}
	from, err := time.Parse(dateLayout, fromParam)
	if err != nil {
		return nil, fmt.Errorf("from: expected YYYY-MM-DD, got %q", fromParam)
	}
	to, err := time.Parse(dateLayout, toParam)
	if err != nil {
		return nil, fmt.Errorf("to: expected YYYY-MM-DD, got %q", toParam)
	}
	if to.Before(from) {
		return nil, fmt.Errorf("to (%s) is before from (%s)", toParam, fromParam)
	}

	var weeks []time.Time
	for wk := mondayOf(from); !wk.After(to); wk = wk.AddDate(0, 0, 7) {
		if len(weeks) == maxWeeks {
			return nil, fmt.Errorf("range spans more than %d weeks", maxWeeks)
		}
		weeks = append(weeks, wk)
	}
	return weeks, nil
}

func mondayOf(t time.Time) time.Time {
	daysSinceMonday := (int(t.Weekday()) + 6) % 7
	return t.AddDate(0, 0, -daysSinceMonday)
}
