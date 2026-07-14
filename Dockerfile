FROM node:20-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /data
ENV DATA_DIR=/data
EXPOSE 8000

FROM base AS production
RUN npm install -g pm2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
