# Build context is the REPO ROOT (see docker-compose.yml), so the image
# contains both the API server and the static frontend.
FROM node:24-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY frontend ./frontend
WORKDIR /app/server
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
