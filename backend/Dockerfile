FROM alpine:latest

WORKDIR /app

# Copy the pre-compiled binary
COPY main .

# Add necessary permissions
RUN chmod +x main

# Expose port 8080
EXPOSE 8080

# Run the application
CMD ["./main"] 