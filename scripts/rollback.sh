#!/usr/bin/env bash
# Retour arrière vers un commit précédent déjà déployé avec succès.
# Exécuter DEPUIS le serveur, à la racine du dépôt cloné.
#
# Usage :
#   ./scripts/rollback.sh production [commit]
#   ./scripts/rollback.sh staging [commit]
#
# Si [commit] est omis, utilise le contenu de .last_good_<environnement> (écrit automatiquement
# par un déploiement réussi de scripts/deploy.sh) — donc "reviens à la dernière version qui
# fonctionnait", sans avoir à retrouver le hash soi-même.
set -euo pipefail

ENVIRONMENT="${1:?Usage: ./scripts/rollback.sh production|staging [commit]}"
case "$ENVIRONMENT" in
  production) COMPOSE_FILE="docker-compose.prod.yml"; ENV_FILE=".env"; HEALTH_URL="http://127.0.0.1:4000/health" ;;
  staging)    COMPOSE_FILE="docker-compose.staging.yml"; ENV_FILE=".env.staging"; HEALTH_URL="http://127.0.0.1:4001/health" ;;
  *) echo "Environnement inconnu : $ENVIRONMENT (attendu: production ou staging)"; exit 1 ;;
esac

TARGET_SHA="${2:-}"
if [ -z "$TARGET_SHA" ]; then
  MARKER=".last_good_${ENVIRONMENT}"
  [ -f "$MARKER" ] || { echo "Aucun commit fourni et $MARKER introuvable : préciser le commit explicitement."; exit 1; }
  TARGET_SHA=$(cat "$MARKER")
fi

echo "Retour vers $TARGET_SHA sur $ENVIRONMENT..."
if [ -n "$(git status --porcelain)" ]; then
  echo "Modifications locales non commitées détectées sur le serveur : arrêt."
  exit 1
fi

git checkout "$TARGET_SHA"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

echo "Attente de la disponibilité de l'API ($HEALTH_URL)..."
for i in $(seq 1 30); do
  if curl -sf "$HEALTH_URL" > /dev/null; then
    echo "Retour arrière réussi : $ENVIRONMENT est de nouveau sur $TARGET_SHA."
    echo "Pensez à revenir sur la branche de travail habituelle avec 'git checkout <branche>' une"
    echo "fois le correctif préparé, ce commande a placé le dépôt en HEAD détaché sur ce commit."
    exit 0
  fi
  sleep 2
done

echo "L'API ne répond toujours pas après le retour arrière. Vérifier les journaux :"
echo "  docker compose -f $COMPOSE_FILE logs api --tail=100"
exit 1
