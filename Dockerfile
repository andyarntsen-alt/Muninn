FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Create data directory
RUN mkdir -p /data

# Environment variables
ENV NODE_ENV=production
ENV MUNINN_DATA_DIR=/data

# The data directory should be mounted as a volume
VOLUME /data

# Start Muninn
CMD ["node", "dist/cli/index.js", "start", "--data-dir", "/data"]
