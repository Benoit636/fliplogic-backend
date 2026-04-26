FROM node:18-alpine
WORKDIR /app/fliplogic-backend
COPY fliplogic-backend/package*.json ./
RUN npm ci --only=production
COPY fliplogic-backend/src ./src
EXPOSE 3000
CMD ["node", "src/server.js"]
