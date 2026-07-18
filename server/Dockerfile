# ---- Backend Express (MyPlayLog API) ----
FROM node:20-alpine

# ffmpeg système : le montage vidéo du mur média (lib/videoEdit.js). Le binaire
# de ffmpeg-static (glibc) ne tourne pas sur alpine (musl), d'où FFMPEG_PATH.
RUN apk add --no-cache ffmpeg
ENV FFMPEG_PATH=ffmpeg

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
