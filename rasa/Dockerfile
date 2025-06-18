FROM rasa/rasa:3.6.10

# Switch to root to set permissions
USER root

# Set working directory
WORKDIR /app

# Copy project files into the container
COPY . /app

# Fix permissions: give access to the default Rasa user (UID 1001)
RUN chown -R 1001:1001 /app

# Switch back to non-root user
USER 1001

# Train Rasa model
RUN rasa train

# Start the Rasa server
CMD ["run", "--enable-api", "--cors", "*", "--debug"]
