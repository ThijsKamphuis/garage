# Use the official Node.js 20 image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies (copying package files first for caching)
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Your app probably runs on 3000; change if different
EXPOSE 7272

# Start the application
CMD [ "npm", "start" ]