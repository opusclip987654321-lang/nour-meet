#!/usr/bin/env bash
# Sauvegarde quotidienne de la base de production. À brancher sur une tâche planifiée du serveur
# (cron, systemd timer...) — rien ici ne s'exécute automatiquement tout seul.
#
# Exemple de crontab (tous les jours à 3h du matin, heure serveur) :
#   0 3 * * * /chemin/vers/nour-v2/scripts/backup-db.sh >> /var/log/nour-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nour-meet}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CONTAINER="${POSTGRES_CONTAINER:-nour-v2-postgres-1}"
DB_USER="${POSTGRES_USER:-nour}"
DB_NAME="${POSTGRES_DB:-nour_meet}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom \
  > "$BACKUP_DIR/nour_meet_${TIMESTAMP}.dump"

# Supprime les sauvegardes plus vieilles que RETENTION_DAYS jours.
find "$BACKUP_DIR" -name "nour_meet_*.dump" -mtime "+${RETENTION_DAYS}" -delete

echo "Sauvegarde écrite : $BACKUP_DIR/nour_meet_${TIMESTAMP}.dump"
echo "Pensez à copier régulièrement ce dossier hors du serveur (S3, autre machine...) : une"
echo "sauvegarde qui ne vit que sur le même disque que la base ne protège pas d'une panne disque."

# Restauration (à faire manuellement, jamais automatiquement) :
#   docker exec -i nour-v2-postgres-1 pg_restore -U nour -d nour_meet --clean --if-exists \
#     < nour_meet_20260101_030000.dump
