package main

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// unreachableServer returns a server whose pool points at a closed port, so
// every query fails with a connection error full of details the client
// shouldn't see.
func unreachableServer(t *testing.T) *server {
	t.Helper()
	db, err := pgxpool.New(context.Background(),
		"postgres://capacity:capacity@127.0.0.1:1/capacity?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	t.Cleanup(db.Close)
	return &server{db: db}
}

// captureLog redirects the standard logger for the duration of the test.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev) })
	return &buf
}

func TestInternalErrorsAreLoggedNotLeaked(t *testing.T) {
	s := unreachableServer(t)
	tests := []struct {
		name, method, target, body, wantLog string
	}{
		{"capacity", http.MethodGet, "/api/capacity?from=2026-01-05&to=2026-01-11", "", "GET /api/capacity?from=2026-01-05&to=2026-01-11: query capacity:"},
		{"update person", http.MethodPatch, "/api/people/4", `{"weekly_hours": 32}`, "PATCH /api/people/4: update person:"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logs := captureLog(t)

			rec := do(t, s, tt.method, tt.target, tt.body)

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500; body: %s", rec.Code, rec.Body.String())
			}
			if got, want := rec.Body.String(), `{"error":"internal server error"}`+"\n"; got != want {
				t.Errorf("body = %q, want %q", got, want)
			}
			if !strings.Contains(logs.String(), tt.wantLog) || !strings.Contains(logs.String(), "127.0.0.1:1") {
				t.Errorf("log = %q, want the request line and the underlying connection error", logs.String())
			}
		})
	}
}

// A request the client already abandoned (the grid aborting a superseded range
// load) must not be logged as a server failure. Nothing is written either; net/http
// then sends an implicit empty 200 to a client that is no longer listening, so
// the status code isn't meaningful here and isn't asserted.
func TestInternalErrorSkipsCancelledRequests(t *testing.T) {
	s := unreachableServer(t)
	logs := captureLog(t)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/capacity?from=2026-01-05&to=2026-01-11", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)

	if logs.Len() != 0 {
		t.Errorf("logged %q for a cancelled request", logs.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("wrote %q to a cancelled request", rec.Body.String())
	}
}
