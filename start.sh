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
  echo "🔗  DATA_DIR=$DATA_DIR — Linking /app/uploads et /app/db → $DATA_DIR"

  # Créer les dossiers cibles dans le volume si absents
  mkdir -p "$DATA_DIR/uploads/library" "$DATA_DIR/uploads/renders" "$DATA_DIR/uploads/models3d" "$DATA_DIR/db"

  # Remplacer /app/uploads par un symlink si c'est un dossier classique
  if [ ! -L /app/uploads ]; then
    rm -rf /app/uploads
    ln -sf "$DATA_DIR/uploads" /app/uploads
    echo "   ✅ /app/uploads → $DATA_DIR/uploads"
  fi

  # /app/db n'est PAS un symlink (database.js utilise DATA_DIR directement)
  # mais on le crée au cas où d'autres scripts l'utilisent
  if [ ! -L /app/db ]; then
    rm -rf /app/db
    ln -sf "$DATA_DIR/db" /app/db
    echo "   ✅ /app/db → $DATA_DIR/db"
  fi
else
  echo "ℹ️  DATA_DIR non défini — mode local (docker-compose bind mounts)"
  mkdir -p /app/uploads/library /app/uploads/renders /app/uploads/models3d /app/db
fi

echo "🚀  Démarrage de TextileLab Studio..."
exec node server.js
