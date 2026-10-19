# Imagen oficial de Playwright: trae Chromium y sus dependencias del sistema ya instaladas.
# La versión DEBE coincidir con "playwright" en package.json (hoy 1.63.0).
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

# Primero solo los manifiestos, para aprovechar la caché de capas de Docker
COPY package.json package-lock.json ./
RUN npm ci

# El resto del código y la compilación a dist/
COPY . .
RUN npm run build

# En producción las variables vienen del panel de Render, no de un archivo .env
ENV NODE_ENV=production

# node --env-file-if-exists=.env dist/index.js (si no hay .env, lo ignora)
CMD ["npm", "start"]
