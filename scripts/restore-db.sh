#!/usr/bin/env bash
# Restauration d'une sauvegarde pg_dump (--format=custom) vers un conteneur PostgreSQL cible.
# JAMAIS exécuté automatiquement (ni par un cron, ni par deploy.sh) : une restauration écrase la
# base cible, elle doit toujours être une décision humaine explicite.
#
# Usage :
#   ./scripts/restore-db.sh <fichier.dump> <conteneur_postgres> <utilisateur> <base>
#   ./scripts/restore-db.sh nour_meet_20260101_030000.dump nour-v2-postgres-1 nour nour_meet
#
# Procédure recommandée avant de restaurer en production :
#   1. Restaurer d'abord vers l'environnement de STAGING (jamais directement en production) pour
#      vérifier que la sauvegarde est exploitable.
#   2. Ne restaurer en production que si la base de prod elle-même est compromise/perdue — sinon
#      cela écrase des données réelles créées depuis la sauvegarde.
set -euo pipefail

DUMP_FILE="${1:?Usage: ./scripts/restore-db.sh <fichier.dump> <conteneur> <utilisateur> <base>}"
CONTAINER="${2:?conteneur PostgreSQL cible manquant}"
DB_USER="${3:?utilisateur PostgreSQL manquant}"
DB_NAME="${4:?nom de base manquant}"

[ -f "$DUMP_FILE" ] || { echo "Fichier introuvable : $DUMP_FILE"; exit 1; }

echo "Restauration de $DUMP_FILE vers $DB_NAME sur le conteneur $CONTAINER."
echo "Ceci REMPLACE le contenu actuel de cette base. Continuer ? (taper 'oui' pour confirmer)"
read -r CONFIRMATION
[ "$CONFIRMATION" = "oui" ] || { echo "Annulé."; exit 1; }

docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists < "$DUMP_FILE"

echo "Restauration terminée. Vérifier ensuite l'intégrité des données avant de rouvrir le service."
