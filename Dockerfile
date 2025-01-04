FROM --platform=$TARGETPLATFORM alpine:latest

WORKDIR /app

# Copy the pre-built backend binary
COPY output/main .

# Copy the pre-built frontend static files
COPY output/static ./static

# Add necessary permissions
RUN chmod +x main

# Expose port 8080
EXPOSE 8080

# Run the application
CMD ["./main"] 