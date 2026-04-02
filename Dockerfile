# ── TextileLab Studio — Dockerfile ──────────────────────────────────────────
# Compatible Railway (volume persistant /data) + docker-compose local
#
# Railway — configurer dans le dashboard :
#   Volumes → Mount path : /data
#   → SQLite DB  : /data/textilelab.db
#   → Uploads    : /data/uploads/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base

# Dépendances système pour @napi-rs/canvas et sharp
RUN apk add --no-cache \
    python3 make g++ \
    cairo-dev pango-dev libjpeg-turbo-dev giflib-dev librsvg-dev \
    fontconfig ttf-dejavu

WORKDIR /app

# ── Installer les dépendances npm ────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# ── Image finale ──────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

# Copier les dépendances installées
COPY --from=deps /app/node_modules ./node_modules

# Copier le code source (uploads/ et db/ locaux exclus via .dockerignore)
COPY . .

# Répertoire persistant Railway monté sur /data
# En local docker-compose : ./db et ./uploads sont bind-mountés directement
ENV DATA_DIR=/data
RUN mkdir -p /data/uploads/library /data/uploads/renders /data/db

# Script d'entrée (gère les symlinks Railway / local)
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Exposer le port (Railway injecte PORT dynamiquement, on expose 3001 par défaut)
EXPOSE 3001

# Health check — utilise $PORT si défini, sinon 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3001}/health || exit 1

# Démarrer via le script d'entrée
CMD ["/app/start.sh"]
