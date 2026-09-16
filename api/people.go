package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// maxWeeklyHours is the number of hours in a week — anything above is a typo.
const maxWeeklyHours = 168

type updatePersonRequest struct {
	WeeklyHours *float64 `json:"weekly_hours"`
}

type person struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	WeeklyHours float64 `json:"weekly_hours"`
}

// handleUpdatePerson serves PATCH /api/people/{id} with {"weekly_hours": n}.
//
// It returns the updated person. It deliberately does not return capacity
// numbers: the client refetches the range it is showing, so how capacity is
// derived lives only in the capacity query.
func (s *server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "id must be a positive integer")
		return
	}

	var req updatePersonRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	if req.WeeklyHours == nil {
		writeError(w, http.StatusBadRequest, "weekly_hours is required")
		return
	}
	if h := *req.WeeklyHours; h < 0 || h > maxWeeklyHours {
		writeError(w, http.StatusBadRequest, "weekly_hours must be between 0 and 168")
		return
	}

	var p person
	err = s.db.QueryRow(r.Context(), `
		UPDATE people
		SET weekly_hours = $1
		WHERE id = $2
		RETURNING id, name, weekly_hours::float8`,
		*req.WeeklyHours, id,
	).Scan(&p.ID, &p.Name, &p.WeeklyHours)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		writeInternalError(w, r, fmt.Errorf("update person: %w", err))
		return
	}

	writeJSON(w, http.StatusOK, p)
}
