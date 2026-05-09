# Home Server

A microservices-based application for monitoring and controlling an Arduino device. The application consists of a React frontend, Go backend, and PostgreSQL database.

## Features

- Monitor Arduino device connection status
- View last connection time and error codes
- Set and view alarm times
- REST API for Arduino device communication

## Prerequisites

- Docker
- Docker Compose
- Make

## Project Structure

```
.
├── frontend/          # React frontend application
├── backend/           # Go backend service
├── docker-compose/    # Docker compose configuration
├── docker-compose.yml # Main docker compose file
├── Makefile          # Build and deployment automation
└── README.md         # This file
```

## Getting Started

1. Clone the repository
2. Build the application:
   ```bash
   make build
   ```

3. Start the services:
   ```bash
   make start
   ```

4. The application will be available at:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8080

5. To stop the services:
   ```bash
   make stop
   ```

## API Endpoints

### Frontend API Endpoints

- `GET /api/device/status` - Get the latest device status
- `GET /api/alarm` - Get the current alarm time
- `POST /api/alarm` - Set a new alarm time

### Arduino API Endpoint

- `GET /api/device/validate` - Endpoint for Arduino to validate its connection
  - Query Parameters:
    - `error` (optional) - Error code if any issues occurred

## Development

To restart the services during development:
```bash
make restart
```

To view logs:
```bash
make logs
```

To clean up all containers and volumes:
```bash
make clean
``` 