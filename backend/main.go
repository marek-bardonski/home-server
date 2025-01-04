package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	_ "github.com/lib/pq"
)

type Device struct {
	ID              int       `json:"id"`
	LastSeen        time.Time `json:"last_seen"`
	ErrorCode       *string   `json:"error_code,omitempty"`
	CO2Level        float64   `json:"co2_level"`
	SoundLevel      float64   `json:"sound_level"`
	AlarmActive     bool      `json:"alarm_active"`
	AlarmActiveTime int64     `json:"alarm_active_time"` // in seconds
	CurrentTime     int64     `json:"current_time"`      // Unix timestamp for Arduino
}

type AlarmTime struct {
	Time  string `json:"time"`
	Armed bool   `json:"armed"`
}

type SensorData struct {
	Timestamp  time.Time `json:"timestamp"`
	CO2Level   float64   `json:"co2_level"`
	SoundLevel float64   `json:"sound_level"`
}

var db *sql.DB

func main() {
	initDB()
	createTables()

	e := echo.New()

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	// API routes
	api := e.Group("/api")
	api.GET("/device/status", getDeviceStatus)
	api.GET("/alarm", getAlarmTime)
	api.POST("/alarm", setAlarmTime)
	api.GET("/sensor-data", getSensorData)
	api.POST("/device/update", handleDeviceUpdate)

	// Serve static files
	e.Static("/static", "static/static")

	// Serve other static files from the root of the static directory
	e.File("/favicon.ico", "static/favicon.ico")
	e.File("/logo192.png", "static/logo192.png")
	e.File("/logo512.png", "static/logo512.png")
	e.File("/manifest.json", "static/manifest.json")
	e.File("/robots.txt", "static/robots.txt")

	// Handle SPA routing - serve index.html for any unmatched routes
	e.GET("/*", func(c echo.Context) error {
		return c.File("static/index.html")
	})

	port := ":8080"
	log.Printf("Server starting on port %s", port)
	log.Fatal(e.Start(port))
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
			sound_level FLOAT NOT NULL DEFAULT 0,
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
			sound_level FLOAT NOT NULL
		);

		-- Index for faster time-based queries
		CREATE INDEX IF NOT EXISTS idx_sensor_data_timestamp ON sensor_data(timestamp);
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func getDeviceStatus(c echo.Context) error {
	var device Device
	err := db.QueryRow(`
		SELECT id, last_seen, error_code, co2_level, sound_level, alarm_active, alarm_active_time 
		FROM device_status 
		ORDER BY last_seen DESC LIMIT 1
	`).Scan(&device.ID, &device.LastSeen, &device.ErrorCode, &device.CO2Level,
		&device.SoundLevel, &device.AlarmActive, &device.AlarmActiveTime)

	if err != nil && err != sql.ErrNoRows {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Add current time to response
	device.CurrentTime = time.Now().Unix()

	return c.JSON(http.StatusOK, device)
}

type DeviceUpdate struct {
	ErrorCode       *string `json:"error_code"`
	CO2Level        float64 `json:"co2_level"`
	SoundLevel      float64 `json:"sound_level"`
	AlarmActive     bool    `json:"alarm_active"`
	AlarmActiveTime int64   `json:"alarm_active_time"`
}

func handleDeviceUpdate(c echo.Context) error {
	var update DeviceUpdate
	if err := c.Bind(&update); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	// Start a transaction
	tx, err := db.Begin()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer tx.Rollback()

	// Insert device status
	_, err = tx.Exec(`
		INSERT INTO device_status 
		(last_seen, error_code, co2_level, sound_level, alarm_active, alarm_active_time)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, time.Now(), update.ErrorCode, update.CO2Level, update.SoundLevel,
		update.AlarmActive, update.AlarmActiveTime)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Insert sensor data
	_, err = tx.Exec(`
		INSERT INTO sensor_data (timestamp, co2_level, sound_level)
		VALUES ($1, $2, $3)
	`, time.Now(), update.CO2Level, update.SoundLevel)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	if err = tx.Commit(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Return current alarm configuration
	var alarmTime AlarmTime
	err = db.QueryRow("SELECT time, armed FROM alarm_time ORDER BY id DESC LIMIT 1").
		Scan(&alarmTime.Time, &alarmTime.Armed)
	if err != nil && err != sql.ErrNoRows {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Create response with current time
	response := struct {
		Time        string `json:"time"`
		Armed       bool   `json:"armed"`
		CurrentTime int64  `json:"current_time"`
	}{
		Time:        alarmTime.Time,
		Armed:       alarmTime.Armed,
		CurrentTime: time.Now().Unix(),
	}

	return c.JSON(http.StatusOK, response)
}

func getAlarmTime(c echo.Context) error {
	var alarmTime AlarmTime
	err := db.QueryRow("SELECT time, armed FROM alarm_time ORDER BY id DESC LIMIT 1").
		Scan(&alarmTime.Time, &alarmTime.Armed)

	if err != nil && err != sql.ErrNoRows {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, alarmTime)
}

func setAlarmTime(c echo.Context) error {
	var alarmTime AlarmTime
	if err := c.Bind(&alarmTime); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	_, err := db.Exec("INSERT INTO alarm_time (time, armed) VALUES ($1, $2)",
		alarmTime.Time, true)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.NoContent(http.StatusCreated)
}

func getSensorData(c echo.Context) error {
	// Get raw sensor data for the last week
	rows, err := db.Query(`
		SELECT timestamp, co2_level, sound_level
		FROM sensor_data 
		WHERE timestamp > NOW() - INTERVAL '7 days'
		ORDER BY timestamp ASC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var data []SensorData
	for rows.Next() {
		var d SensorData
		if err := rows.Scan(&d.Timestamp, &d.CO2Level, &d.SoundLevel); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		data = append(data, d)
	}

	return c.JSON(http.StatusOK, data)
}
