# Match the pinned local and CI Node.js runtime.
FROM node:24.22.0-alpine

# Set working directory
WORKDIR /app

# Copy root and workspace package files
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install the locked workspace dependencies before application source is copied.
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci

# Copy the rest of the monorepo source
COPY . .

# Both applications consume the compiled shared workspace.
RUN npm run build:shared

# Set working dir back to target application
WORKDIR /app/client

# Expose port
EXPOSE 5173

# Start development server
CMD ["npm", "--prefix", "/app", "run", "dev:frontend"]
