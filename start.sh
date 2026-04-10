#!/bin/sh
# ── TextileLab Studio — Entrypoint ───────────────────────────────────────────
# Ce script s'exécute AVANT node server.js.
# En prod Railway (DATA_DIR=/data) : crée des symlinks pour que les routes
# qui écrivent dans ./uploads/ et ./db/ écrivent bien dans le volume persistant.
# En local (DATA_DIR non défini) : ne fait rien, les bind mounts docker-compose
# gèrent la persistance directement.
# ─────────────────────────────────────────────────────────────────────────────
set -e

if [ -n "$DATA_DIR" ]; then
  echo "🔗  DATA_DIR=$DATA_DIR — Linking /app/uploads → $DATA_DIR/uploads"

  # Créer les dossiers uploads dans le volume si absents
  mkdir -p "$DATA_DIR/uploads/library" "$DATA_DIR/uploads/renders" "$DATA_DIR/uploads/models3d" "$DATA_DIR/uploads/generated"

  # Remplacer /app/uploads par un symlink si c'est un dossier classique
  if [ ! -L /app/uploads ]; then
    rm -rf /app/uploads
    ln -sf "$DATA_DIR/uploads" /app/uploads
    echo "   ✅ /app/uploads → $DATA_DIR/uploads"
  fi

  # ⚠ Ne PAS symlinkter /app/db — database.js utilise DATA_DIR pour le .db
  # et db/database.js (code) doit rester accessible dans /app/db/
else
  echo "ℹ️  DATA_DIR non défini — mode local (docker-compose bind mounts)"
  mkdir -p /app/uploads/library /app/uploads/renders /app/uploads/models3d /app/uploads/generated
fi

echo "🚀  Démarrage de TextileLab Studio..."
exec node server.js
