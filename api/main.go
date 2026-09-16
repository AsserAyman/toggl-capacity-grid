package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type server struct {
	db *pgxpool.Pool
}

func main() {
	ctx := context.Background()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://capacity:capacity@localhost:5432/capacity?sslmode=disable"
	}

	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer db.Close()

	for i := 0; i < 30; i++ {
		if err = db.Ping(ctx); err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Fatalf("ping: %v", err)
	}

	s := &server{db: db}

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", s.routes()))
}

func (s *server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/capacity", s.handleCapacity)
	mux.HandleFunc("PATCH /api/people/{id}", s.handleUpdatePerson)
	return mux
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	var people int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM people`).Scan(&people); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "people": people})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeInternalError logs err and sends the client a generic 500. Database
// errors carry SQL and schema details that belong in the logs, not in the UI.
func writeInternalError(w http.ResponseWriter, r *http.Request, err error) {
	// The client went away (e.g. the grid aborted a superseded range load):
	// nobody reads the response and it isn't a server fault worth logging.
	if r.Context().Err() != nil {
		return
	}
	log.Printf("%s %s: %v", r.Method, r.URL, err)
	writeError(w, http.StatusInternalServerError, "internal server error")
}
