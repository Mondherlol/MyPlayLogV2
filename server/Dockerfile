# ---- Backend Express (MyPlayLog API) ----
FROM node:20-alpine

# ffmpeg système : le montage vidéo du mur média (lib/videoEdit.js). Le binaire
# de ffmpeg-static (glibc) ne tourne pas sur alpine (musl), d'où FFMPEG_PATH.
RUN apk add --no-cache ffmpeg
ENV FFMPEG_PATH=ffmpeg

# yt-dlp : extraction audio des OST (routes/audio.js). On prend la dernière
# release (zipapp python) plutôt que le paquet apk, souvent en retard — et
# YouTube casse régulièrement les vieux extracteurs. En cas de panne
# d'extraction en prod : rebuild sans cache pour récupérer la version du jour.
RUN apk add --no-cache python3 \
  && wget -qO /usr/local/bin/yt-dlp \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp
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
