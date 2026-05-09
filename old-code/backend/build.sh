#!/bin/sh
export CGO_ENABLED=0
export GOOS=linux
export GOARCH=amd64

# Download dependencies
go mod download
go mod tidy

# Build the binary
go build -o main . 