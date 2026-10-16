# Sala 5B — imagem para a VPS (Easypanel). HTTPS fica no proxy do Easypanel.
FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Dados das sessões fora da imagem (monte um volume em /data)
RUN mkdir -p /data && chown -R node:node /data /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TRUST_PROXY=true \
    COOKIE_SECURE=true
VOLUME ["/data"]
EXPOSE 8080

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "server.js"]
