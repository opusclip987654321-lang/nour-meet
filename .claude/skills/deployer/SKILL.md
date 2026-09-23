---
name: deployer
description: Vérifie Nūr Meet (types, tests, build, main poussée) puis déploie en staging ou en production via scripts/deploy.sh sur le serveur.
disable-model-invocation: true
---

# Déployer Nūr Meet

Argument : `staging` ou `production` (par défaut : `staging`). Un déploiement en **production**
n'a lieu que si l'utilisateur a écrit explicitement `production`.

## 1. Vérifications locales (tout doit passer, sinon on s'arrête et on explique)

```bash
git fetch origin main
git status --porcelain                 # rien de non commité
git rev-parse main origin/main         # main locale = main distante (sinon pousser d'abord)
npm run typecheck && npm test && npm run build
```

Rappeler à l'utilisateur de vérifier que la CI GitHub de ce commit est verte (onglet Actions),
les tests d'intégration n'y tournant qu'avec les secrets Stripe de test configurés.

Lister les migrations Prisma ajoutées depuis le dernier déploiement connu
(`git diff --stat <dernier tag/commit déployé>..main -- apps/api/prisma/migrations`, si connu) et
signaler toute opération destructive.

## 2. Déploiement

Le script `scripts/deploy.sh` s'exécute **sur le serveur**, à la racine du dépôt cloné.

- Si les variables `NOUR_DEPLOY_SSH` (ex. `ubuntu@1.2.3.4`) et `NOUR_DEPLOY_DIR` (ex.
  `/srv/nour-meet`) sont définies (dans `.claude/settings.local.json`, clé `env`) :
  ```bash
  ssh "$NOUR_DEPLOY_SSH" "cd '$NOUR_DEPLOY_DIR' && ./scripts/deploy.sh <environnement>"
  ```
- Sinon : ne rien exécuter, donner à l'utilisateur la commande exacte à lancer sur le serveur et
  lui indiquer comment définir ces deux variables pour la prochaine fois.

## 3. Après le déploiement

- Vérifier `/health` de l'environnement (le script le fait aussi) et le rapporter.
- En cas d'échec : `./scripts/rollback.sh <environnement>` sur le serveur ramène la dernière version
  saine — le proposer, ne jamais le lancer sans accord.
