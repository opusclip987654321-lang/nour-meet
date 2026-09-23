#!/usr/bin/env bash
# Sauvegarde quotidienne de la base de production, avec copie externalisée automatique si rclone
# est configuré. À brancher sur une tâche planifiée du serveur (cron, systemd timer...) — rien ici
# ne s'exécute automatiquement tout seul.
#
# Exemple de crontab (tous les jours à 3h du matin, heure serveur) :
#   0 3 * * * /chemin/vers/nour-v2/scripts/backup-db.sh >> /var/log/nour-backup.log 2>&1
#
# Externalisation (recommandé, OVHcloud Object Storage ou tout autre S3 compatible) :
#   1. Créer un conteneur de stockage objet (ex. OVH Public Cloud Storage, compatible S3/Swift).
#   2. Installer rclone sur le serveur (apt install rclone) et le configurer une fois avec
#      `rclone config` (voir rclone.org/s3 ou rclone.org/swift selon l'offre OVH choisie).
#   3. Exporter RCLONE_REMOTE avant d'appeler ce script (ex. RCLONE_REMOTE="ovh:nour-meet-backups").
# Sans RCLONE_REMOTE défini, la sauvegarde reste uniquement locale — donc PAS protégée contre une
# panne ou une perte du serveur lui-même : ce n'est qu'une étape intermédiaire, pas une vraie
# stratégie de sauvegarde à elle seule.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nour-meet}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CONTAINER="${POSTGRES_CONTAINER:-nour-v2-postgres-1}"
DB_USER="${POSTGRES_USER:-nour}"
DB_NAME="${POSTGRES_DB:-nour_meet}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="nour_meet_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom \
  > "$BACKUP_DIR/$FILENAME"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$BACKUP_DIR/$FILENAME" "$RCLONE_REMOTE/" && \
    echo "Copié hors du serveur vers $RCLONE_REMOTE/$FILENAME" || \
    echo "ATTENTION : échec de la copie externalisée vers $RCLONE_REMOTE — la sauvegarde locale existe, mais n'est pas protégée d'une panne serveur tant que ceci n'est pas résolu."
else
  echo "RCLONE_REMOTE non défini : sauvegarde uniquement locale, voir l'en-tête de ce script pour l'externaliser."
fi

# Supprime les sauvegardes locales plus vieilles que RETENTION_DAYS jours (la rétention côté
# stockage objet distant se règle séparément, dans sa propre politique de cycle de vie).
find "$BACKUP_DIR" -name "nour_meet_*.dump" -mtime "+${RETENTION_DAYS}" -delete

echo "Sauvegarde écrite : $BACKUP_DIR/$FILENAME"

# Restauration : voir scripts/restore-db.sh (procédure testée, jamais automatique).
