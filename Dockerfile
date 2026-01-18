FROM node:18-slim

WORKDIR /app

# Install system dependencies for native bindings if needed
# RUN apt-get update && apt-get install -y build-essential

# Install app dependencies
COPY package.json ./
RUN npm install --production

# Copy source
COPY lib ./lib
COPY bin ./bin
COPY skills ./skills

# Create data directory
RUN mkdir -p runtime/data/lancedb && chmod 777 runtime/data/lancedb
ENV LANCEDB_URI=/app/runtime/data/lancedb

# Link binaries
RUN npm link

# Default entrypoint
ENTRYPOINT ["memory-mesh"]
