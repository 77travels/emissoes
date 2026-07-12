# Imagem para hospedar em qualquer serviço com Docker (Railway, Fly.io, VPS...)
FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# o banco SQLite fica em /app/data — monte um volume persistente aqui
VOLUME /app/data

CMD ["node", "server.js"]
