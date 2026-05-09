.PHONY: all build clean run stop build-backend build-frontend docker-build init-backend init-frontend status

# Default target
all: build run

# Clean build artifacts
clean:
	rm -rf output || true
	docker-compose down -v || true

# Initialize backend dependencies
init-backend:
	@echo "Initializing backend dependencies..."
	cd backend && go mod tidy && go mod download

# Initialize frontend dependencies
init-frontend:
	@echo "Initializing frontend dependencies..."
	cd frontend && yarn install

# Build everything
build: clean init-backend init-frontend build-backend build-frontend docker-build

# Build backend
build-backend:
	@echo "Building backend..."
	mkdir -p output
	cd backend && GOARCH=arm64 GOOS=linux go build -o ../output/main
	chmod +x output/main

# Build frontend
build-frontend:
	@echo "Building frontend..."
	cd frontend && yarn build
	cp -R frontend/build output/static

# Build Docker image
docker-build:
	@echo "Building Docker image..."
	docker build --platform linux/arm64 -t home-server-backend .

# Run the application
run:
	@echo "Starting services..."
	docker-compose up -d

# Run in detached mode
run-detached:
	@echo "Starting services in detached mode..."
	docker-compose up -d
	@echo "Services started in background. Use 'make logs' to view logs or 'make status' to check status"

# Stop the application
stop:
	@echo "Stopping services..."
	docker-compose down

# Show logs
logs:
	docker-compose logs -f

# Check status
status:
	@echo "Checking service status..."
	docker-compose ps
	@echo "\nContainer logs:"
	docker-compose logs --tail=20

# Development targets
dev-backend:
	@echo "Running backend in development mode..."
	cd backend && go run main.go

dev-frontend:
	@echo "Running frontend in development mode..."
	cd frontend && yarn start 
