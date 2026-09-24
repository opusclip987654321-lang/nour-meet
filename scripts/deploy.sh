#!/usr/bin/env bash
# Déploiement reproductible d'un environnement (staging ou production) sur le serveur.
# Exécuter DEPUIS le serveur, à la racine du dépôt cloné.
#
# Usage :
#   ./scripts/deploy.sh production   (utilise docker-compose.prod.yml + .env)
#   ./scripts/deploy.sh staging      (utilise docker-compose.staging.yml + .env.staging)
#
# Ce que fait ce script, dans l'ordre :
# 1. Vérifie qu'il n'y a pas de modification locale non commitée (ne déploie jamais un état bâtard).
# 2. Note le commit actuellement en place (pour un retour arrière avec scripts/rollback.sh).
# 3. Récupère et bascule sur la branche demandée (par défaut celle déjà utilisée sur le serveur).
# 4. Construit les images Docker, les étiquette avec le commit court (git rev-parse --short).
# 5. Démarre les nouveaux conteneurs (les migrations Prisma s'appliquent automatiquement au
#    démarrage du conteneur api, voir la commande dans le fichier compose correspondant).
# 6. Attend que /health réponde correctement ; en cas d'échec, affiche comment revenir en arrière
#    et NE modifie PAS le marqueur de "dernière version saine".
set -euo pipefail

ENVIRONMENT="${1:?Usage: ./scripts/deploy.sh production|staging}"
case "$ENVIRONMENT" in
  production) COMPOSE_FILE="docker-compose.prod.yml"; ENV_FILE=".env"; HEALTH_URL="http://127.0.0.1:4000/health" ;;
  staging)    COMPOSE_FILE="docker-compose.staging.yml"; ENV_FILE=".env.staging"; HEALTH_URL="http://127.0.0.1:4001/health" ;;
  *) echo "Environnement inconnu : $ENVIRONMENT (attendu: production ou staging)"; exit 1 ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo "Fichier $ENV_FILE introuvable. Copier le .example correspondant et le remplir avant de déployer."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Modifications locales non commitées détectées sur le serveur : arrêt (le déploiement ne doit provenir que de git)."
  exit 1
fi

PREVIOUS_SHA=$(git rev-parse HEAD)
echo "Version actuellement déployée : $PREVIOUS_SHA"
echo "$PREVIOUS_SHA" > ".last_deployed_${ENVIRONMENT}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Récupération des derniers commits de la branche $BRANCH..."
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH"

NEW_SHA=$(git rev-parse --short HEAD)
echo "Nouvelle version : $NEW_SHA"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# Le Caddyfile est monté comme fichier unique : git le remplace par un nouveau fichier que le conteneur
# ne voit pas (ni recréation ni rechargement). S'il a changé, on redémarre Caddy (coupure d'une seconde).
if ! git diff --quiet "$PREVIOUS_SHA" HEAD -- infra/Caddyfile && docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --services | grep -qx caddy; then
  echo "Caddyfile modifié : redémarrage de Caddy..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart caddy
fi

echo "Attente de la disponibilité de l'API ($HEALTH_URL)..."
for i in $(seq 1 30); do
  if curl -sf "$HEALTH_URL" > /dev/null; then
    echo "$NEW_SHA" > ".last_good_${ENVIRONMENT}"
    echo "Déploiement réussi : $ENVIRONMENT est sur $NEW_SHA."
    exit 0
  fi
  sleep 2
done

echo "L'API ne répond toujours pas correctement après 60 secondes."
echo "Pour revenir à la version précédente ($PREVIOUS_SHA) :"
echo "  ./scripts/rollback.sh $ENVIRONMENT $PREVIOUS_SHA"
exit 1
