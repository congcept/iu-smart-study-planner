# Use Node.js 20
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy root and workspace package files
COPY package*.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install all workspace dependencies
RUN npm install

# Copy the rest of the monorepo source
COPY . .

# Both applications consume the compiled shared workspace.
RUN npm run build:shared

# Set working dir back to target application
WORKDIR /app/client

# Expose port
EXPOSE 5173

# Start development server
CMD ["npm", "run", "dev", "--", "--host"]
