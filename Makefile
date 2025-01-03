.PHONY: build start stop restart logs clean build-backend

build-backend:
	cd backend && chmod +x build.sh && ./build.sh

build: build-backend
	docker-compose build

start:
	docker-compose up -d

stop:
	docker-compose down

restart: stop start

logs:
	docker-compose logs -f

clean: stop
	docker-compose down -v
	docker system prune -f
	rm -f backend/main 