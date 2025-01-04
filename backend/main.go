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
	ID              int       `json:"id"`
	LastSeen        time.Time `json:"last_seen"`
	ErrorCode       *string   `json:"error_code,omitempty"`
	CO2Level        float64   `json:"co2_level"`
	Temperature     float64   `json:"temperature"`
	AlarmActive     bool      `json:"alarm_active"`
	AlarmActiveTime int64     `json:"alarm_active_time"` // in seconds
}

type AlarmTime struct {
	Time  string `json:"time"`
	Armed bool   `json:"armed"`
}

type SensorData struct {
	Timestamp   time.Time `json:"timestamp"`
	CO2Level    float64   `json:"co2_level"`
	Temperature float64   `json:"temperature"`
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
	r.HandleFunc("/api/alarm/arm", setAlarmArmed).Methods("POST")
	r.HandleFunc("/api/sensor-data", getSensorData).Methods("GET")

	// Arduino endpoint
	r.HandleFunc("/api/device/update", handleDeviceUpdate).Methods("POST")

	// Use CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
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
			error_code TEXT,
			co2_level FLOAT NOT NULL DEFAULT 0,
			temperature FLOAT NOT NULL DEFAULT 0,
			alarm_active BOOLEAN NOT NULL DEFAULT false,
			alarm_active_time BIGINT NOT NULL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS alarm_time (
			id SERIAL PRIMARY KEY,
			time TEXT NOT NULL,
			armed BOOLEAN NOT NULL DEFAULT true
		);

		CREATE TABLE IF NOT EXISTS sensor_data (
			id SERIAL PRIMARY KEY,
			timestamp TIMESTAMP NOT NULL,
			co2_level FLOAT NOT NULL,
			temperature FLOAT NOT NULL
		);

		-- Index for faster time-based queries
		CREATE INDEX IF NOT EXISTS idx_sensor_data_timestamp ON sensor_data(timestamp);
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func getDeviceStatus(w http.ResponseWriter, r *http.Request) {
	var device Device
	err := db.QueryRow(`
		SELECT id, last_seen, error_code, co2_level, temperature, alarm_active, alarm_active_time 
		FROM device_status 
		ORDER BY last_seen DESC LIMIT 1
	`).Scan(&device.ID, &device.LastSeen, &device.ErrorCode, &device.CO2Level,
		&device.Temperature, &device.AlarmActive, &device.AlarmActiveTime)

	if err != nil && err != sql.ErrNoRows {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(device)
}

type DeviceUpdate struct {
	ErrorCode       *string `json:"error_code"`
	CO2Level        float64 `json:"co2_level"`
	Temperature     float64 `json:"temperature"`
	AlarmActive     bool    `json:"alarm_active"`
	AlarmActiveTime int64   `json:"alarm_active_time"`
}

func handleDeviceUpdate(w http.ResponseWriter, r *http.Request) {
	var update DeviceUpdate
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Start a transaction
	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Insert device status
	_, err = tx.Exec(`
		INSERT INTO device_status 
		(last_seen, error_code, co2_level, temperature, alarm_active, alarm_active_time)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, time.Now(), update.ErrorCode, update.CO2Level, update.Temperature,
		update.AlarmActive, update.AlarmActiveTime)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Insert sensor data
	_, err = tx.Exec(`
		INSERT INTO sensor_data (timestamp, co2_level, temperature)
		VALUES ($1, $2, $3)
	`, time.Now(), update.CO2Level, update.Temperature)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err = tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return current alarm configuration
	var alarmTime AlarmTime
	err = db.QueryRow("SELECT time, armed FROM alarm_time ORDER BY id DESC LIMIT 1").
		Scan(&alarmTime.Time, &alarmTime.Armed)
	if err != nil && err != sql.ErrNoRows {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(alarmTime)
}

func getAlarmTime(w http.ResponseWriter, r *http.Request) {
	var alarmTime AlarmTime
	err := db.QueryRow("SELECT time, armed FROM alarm_time ORDER BY id DESC LIMIT 1").
		Scan(&alarmTime.Time, &alarmTime.Armed)

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

	_, err := db.Exec("INSERT INTO alarm_time (time, armed) VALUES ($1, $2)",
		alarmTime.Time, true)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func setAlarmArmed(w http.ResponseWriter, r *http.Request) {
	var armed struct {
		Armed bool `json:"armed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&armed); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	_, err := db.Exec("UPDATE alarm_time SET armed = $1 WHERE id = (SELECT id FROM alarm_time ORDER BY id DESC LIMIT 1)",
		armed.Armed)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func getSensorData(w http.ResponseWriter, r *http.Request) {
	// Get sensor data for the last 24 hours
	rows, err := db.Query(`
		SELECT timestamp, co2_level, temperature 
		FROM sensor_data 
		WHERE timestamp > NOW() - INTERVAL '24 hours'
		ORDER BY timestamp ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var data []SensorData
	for rows.Next() {
		var d SensorData
		if err := rows.Scan(&d.Timestamp, &d.CO2Level, &d.Temperature); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		data = append(data, d)
	}

	json.NewEncoder(w).Encode(data)
}
