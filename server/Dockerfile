# ---- Backend Express (MyPlayLog API) ----
FROM node:20-alpine

# ffmpeg système : le montage vidéo du mur média (lib/videoEdit.js). Le binaire
# de ffmpeg-static (glibc) ne tourne pas sur alpine (musl), d'où FFMPEG_PATH.
RUN apk add --no-cache ffmpeg
ENV FFMPEG_PATH=ffmpeg

# yt-dlp : extraction audio des OST (routes/audio.js). On prend la dernière
# release (zipapp python) plutôt que le paquet apk, souvent en retard — et
# YouTube casse régulièrement les vieux extracteurs.
#
# Le `ADD` d'une URL n'est PAS un caprice : sans lui, la couche d'installation
# reste dans le cache Docker indéfiniment et le conteneur repart en prod avec le
# yt-dlp du jour du premier build, vieux de plusieurs mois — c'est exactement
# comme ça que l'extraction des OST est tombée en panne. Docker compare le
# contenu récupéré par ADD, donc la couche se rejoue dès qu'une release sort.
# (routes/audio.js sait en plus se mettre à jour tout seul en cas d'échec.)
ADD https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest /tmp/yt-dlp-release.json
RUN apk add --no-cache python3 \
  && wget -qO /usr/local/bin/yt-dlp \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version
ENV YTDLP_PATH=/usr/local/bin/yt-dlp

WORKDIR /app

# Installe les dépendances (cache Docker : ne réinstalle que si les lockfiles changent)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Code source
COPY . .

# Le dossier des uploads est monté en volume (voir docker-compose.yml).
# On le crée quand même pour que multer ait sa cible au 1er démarrage.
# Idem pour le cache audio des OST (routes/audio.js).
RUN mkdir -p uploads/covers uploads/avatars uploads/comments uploads/reposts cache/audio

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/index.js"]
