FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY config ./config
RUN mkdir -p /app/uploads
EXPOSE 4000
CMD ["node", "src/server.js"]
