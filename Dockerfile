# Node 22 — compile native addons (better-sqlite3)
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Runtime — lebih kecil
FROM node:22-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
ENTRYPOINT ["tini", "--", "node", "worker/server.mjs"]
