# --- сборка панели ---
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- сборка сервера ---
FROM node:22-alpine AS server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# --- итоговый образ ---
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web/dist UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=server /app/server/node_modules server/node_modules
COPY --from=server /app/server/dist server/dist
COPY --from=server /app/server/package.json server/package.json
COPY server/migrations server/migrations
COPY tracker tracker
COPY --from=web /app/web/dist web/dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
