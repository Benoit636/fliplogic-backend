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
# Run any pending migrations before starting the server, so a new schema
# change (e.g. a new column) takes effect automatically on deploy instead
# of requiring someone to manually run `npm run migrate` against
# production. Migrations are all idempotent (ADD COLUMN IF NOT EXISTS),
# so re-running already-applied ones on every deploy is safe. If a
# migration fails, `&&` stops the container from starting the server
# against a schema it doesn't match, rather than failing silently later.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
