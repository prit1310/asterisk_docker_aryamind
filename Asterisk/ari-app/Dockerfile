# Use official Node.js image
FROM node:18

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definitions
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Ensure recordings folder exists
RUN mkdir -p /var/lib/asterisk/sounds && \
    chmod -R 777 /var/lib/asterisk/sounds

# Expose API port
EXPOSE 3002

# Start app with hot-reloading in dev
CMD ["npm", "run", "dev"]
