# Use Node.js LTS version alpine image for a small size
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definition files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port (Cloud Run will override this via the PORT environment variable)
EXPOSE 8080

# Run the app using node
CMD ["node", "server.js"]
