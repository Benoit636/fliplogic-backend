FROM node:18-alpine

# Puppeteer's bundled Chromium download doesn't run on Alpine/musl —
# install the system Chromium package instead and point Puppeteer at it.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
RUN mkdir -p logs
EXPOSE 3000
CMD ["node", "src/server.js"]
