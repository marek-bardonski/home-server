package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
	"github.com/rs/cors"
)

type Device struct {
	ID        int       `json:"id"`
	LastSeen  time.Time `json:"last_seen"`
	ErrorCode *string   `json:"error_code,omitempty"`
}

type AlarmTime struct {
	Time string `json:"time"`
}

var db *sql.DB

func main() {
	initDB()
	createTables()

	r := mux.NewRouter()

	// Frontend endpoints
	r.HandleFunc("/api/device/status", getDeviceStatus).Methods("GET")
	r.HandleFunc("/api/alarm", getAlarmTime).Methods("GET")
	r.HandleFunc("/api/alarm", setAlarmTime).Methods("POST")

	// Arduino endpoint
	r.HandleFunc("/api/device/validate", validateDevice).Methods("GET")

	// Use CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
	})

	port := ":8080"
	log.Printf("Server starting on port %s", port)
	log.Fatal(http.ListenAndServe(port, c.Handler(r)))
}

func initDB() {
	var err error
	dbInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"))

	db, err = sql.Open("postgres", dbInfo)
	if err != nil {
		log.Fatal(err)
	}

	if err = db.Ping(); err != nil {
		log.Fatal(err)
	}
}

func createTables() {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS device_status (
			id SERIAL PRIMARY KEY,
			last_seen TIMESTAMP NOT NULL,
			error_code TEXT
		);
		CREATE TABLE IF NOT EXISTS alarm_time (
			id SERIAL PRIMARY KEY,
			time TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func getDeviceStatus(w http.ResponseWriter, r *http.Request) {
	var device Device
	err := db.QueryRow("SELECT id, last_seen, error_code FROM device_status ORDER BY last_seen DESC LIMIT 1").
		Scan(&device.ID, &device.LastSeen, &device.ErrorCode)

	if err != nil && err != sql.ErrNoRows {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(device)
}

func validateDevice(w http.ResponseWriter, r *http.Request) {
	errorCode := r.URL.Query().Get("error")

	_, err := db.Exec("INSERT INTO device_status (last_seen, error_code) VALUES ($1, $2)",
		time.Now(), errorCode)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return current alarm time
	var alarmTime AlarmTime
	err = db.QueryRow("SELECT time FROM alarm_time ORDER BY id DESC LIMIT 1").Scan(&alarmTime.Time)
	if err != nil && err != sql.ErrNoRows {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(alarmTime)
}

func getAlarmTime(w http.ResponseWriter, r *http.Request) {
	var alarmTime AlarmTime
	err := db.QueryRow("SELECT time FROM alarm_time ORDER BY id DESC LIMIT 1").Scan(&alarmTime.Time)

	if err != nil && err != sql.ErrNoRows {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(alarmTime)
}

func setAlarmTime(w http.ResponseWriter, r *http.Request) {
	var alarmTime AlarmTime
	if err := json.NewDecoder(r.Body).Decode(&alarmTime); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	_, err := db.Exec("INSERT INTO alarm_time (time) VALUES ($1)", alarmTime.Time)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}
