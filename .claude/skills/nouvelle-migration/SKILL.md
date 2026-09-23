---
name: nouvelle-migration
description: Crée une migration Prisma pour Nūr Meet après une modification de apps/api/prisma/schema.prisma, la génère depuis une base jetable, l'applique et vérifie qu'elle correspond exactement au schéma. À utiliser dès que schema.prisma change ; ne jamais modifier une migration existante.
---

# Nouvelle migration Prisma

Argument optionnel : un nom court en snake_case décrivant le changement (ex. `legal_acceptance`).

## Étapes

1. **Vérifier le point de départ.** `schema.prisma` est modifié, les migrations existantes ne le sont
   pas : `git status --porcelain apps/api/prisma/migrations` doit être vide (le hook du projet refuse
   de toute façon toute modification d'une migration commitée).
2. **Base jetable dédiée** (jamais une base existante, plusieurs Postgres d'autres projets tournent
   sur cette machine) :
   ```bash
   docker run -d --rm --name nour-migration-pg -e POSTGRES_USER=nour -e POSTGRES_PASSWORD=nour_dev_password \
     -e POSTGRES_DB=nour_meet -p 127.0.0.1:5498:5432 postgres:17-alpine
   export DATABASE_URL="postgresql://nour:nour_dev_password@localhost:5498/nour_meet?schema=public"
   until docker exec nour-migration-pg pg_isready -U nour -d nour_meet >/dev/null 2>&1; do sleep 1; done
   cd apps/api && npx prisma migrate deploy
   ```
3. **Générer le SQL** depuis l'état des migrations existantes vers le nouveau schéma :
   ```bash
   dir="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_<nom>"
   mkdir -p "$dir"
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > "$dir/migration.sql"
   ```
4. **Relire le SQL.** Toute opération destructive (DROP COLUMN/TABLE, changement de type, colonne
   NOT NULL sans valeur par défaut sur une table existante) doit être signalée à l'utilisateur avant
   d'aller plus loin : elle peut perdre des données en production.
5. **Appliquer et vérifier** : `npx prisma migrate deploy`, puis
   `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma`
   doit répondre `No difference detected.`
6. **Régénérer le client et vérifier** : `npx prisma generate`, `npm run typecheck` à la racine.
7. **Nettoyer** : `docker stop nour-migration-pg`.

La migration s'appliquera automatiquement en production au démarrage du conteneur api
(`scripts/deploy.sh`). Mentionner dans le récapitulatif final le nom de la migration créée.
