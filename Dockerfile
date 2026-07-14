FROM node:20-slim

WORKDIR /app

# ping butuh iputils (ICMP). Kalau platform blokir ICMP, fallback HTTP otomatis jalan.
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Data persisten (mount volume di sini saat deploy).
RUN mkdir -p /data
ENV DATA_DIR=/data

EXPOSE 8000

CMD ["node", "src/server.js"]
