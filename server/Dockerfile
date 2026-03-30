# Base node image
FROM node:20-alpine

# Set root working directory
WORKDIR /app

# Install dependencies for Prisma
RUN apk add --no-cache openssl

# Copy root and workspace package files
COPY package*.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install all workspace dependencies
RUN npm install

# Copy Prisma schema and run generate
COPY server/prisma ./server/prisma/
RUN cd server && npx prisma generate

# Copy the rest of the monorepo source
COPY . .

# Set working dir to target application
WORKDIR /app/server

# Expose port
EXPOSE 3001

# Start the development server
CMD ["npm", "run", "dev"]
