# Match the pinned local and CI Node.js runtime.
FROM node:24.22.0-alpine

# Set root working directory
WORKDIR /app

# Install dependencies for Prisma
RUN apk add --no-cache openssl

# Copy root and workspace package files
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Generate Prisma explicitly after copying its schema below.
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci

# Copy Prisma schema and run generate
COPY server/prisma ./server/prisma/
RUN cd server && npx prisma generate

# Copy the rest of the monorepo source
COPY . .

# Both applications consume the compiled shared workspace.
RUN npm run build:shared

# Set working dir to target application
WORKDIR /app/server

# Expose port
EXPOSE 3001

# Start the development server
CMD ["npm", "--prefix", "/app", "run", "dev:backend"]
