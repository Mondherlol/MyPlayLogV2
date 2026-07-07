# ---- Backend Express (MyPlayLog API) ----
FROM node:20-alpine

WORKDIR /app

# Installe les dépendances (cache Docker : ne réinstalle que si les lockfiles changent)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Code source
COPY . .

# Le dossier des uploads est monté en volume (voir docker-compose.yml).
# On le crée quand même pour que multer ait sa cible au 1er démarrage.
RUN mkdir -p uploads/covers uploads/avatars uploads/comments uploads/reposts

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/index.js"]
