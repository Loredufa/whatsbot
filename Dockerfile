FROM node:20-slim

# Evita errores de puppeteer en contenedores
ENV PUPPETEER_SKIP_DOWNLOAD=false \
    PUPPETEER_CACHE_DIR=/usr/src/app/.cache \
    PUPPETEER_EXECUTABLE_PATH=""

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Carpeta de cache/sesión
RUN mkdir -p /usr/src/app/.cache
EXPOSE 3000

CMD ["node", "index.js"]
