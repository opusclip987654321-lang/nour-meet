# Nūr Meet — consignes pour Claude

Plateforme de rencontres et de réseautage en présentiel (speed dating, networking) : candidature,
entretien de validation, paiement Stripe, billet QR, mise en relation après l'événement.
Monorepo npm : `apps/api` (Fastify + Prisma + Postgres), `apps/web` (React + Vite),
`apps/mobile` (Expo), `packages/shared` (types et règles communs aux trois).

## Règles non négociables

- **Code et commentaires en français**, dans le style existant : un commentaire explique le
  *pourquoi* (souvent avec la référence du cahier des charges, ex. `§5`, `C31`, `arbitrage 12/E3`),
  jamais le *quoi*.
- **Jamais de donnée juridique ou d'identité de société inventée** (adresse, SIREN, nom, médiateur…).
  Une information manquante s'écrit `[À COMPLÉTER]` ; les textes vivent dans
  `apps/web/src/legal/*.md`, leur version dans `LEGAL_VERSIONS` (`packages/shared`). Changer un texte
  de façon substantielle = changer sa version (l'acceptation est alors redemandée).
- **Service réservé aux 18 ans et plus** : utiliser `isAdult` / `MINIMUM_AGE` de `@nour/shared`,
  jamais un calcul d'âge maison.
- **Aucune donnée sensible** (religion, origine, orientation, santé…) dans les formulaires.
- **Les données comptables ne se suppriment jamais** : suppression de compte = anonymisation
  (`anonymizeUser`), Payment / LedgerEntry / LegalAcceptance sont conservés.
- **Migrations Prisma** : toute modification de `schema.prisma` s'accompagne d'une nouvelle migration
  dans `apps/api/prisma/migrations/`. Ne jamais modifier une migration existante (elle est peut-être
  déjà appliquée en production) — utiliser `/nouvelle-migration`.
- **Ne jamais lire, afficher ni modifier les fichiers `.env*` réels** (seuls les `.example` sont
  versionnés). Stripe : uniquement des clés de TEST (`sk_test_…`) hors production.

## Structure

- `apps/api/src/index.ts` — démarrage : charge `context.ts` (Prisma, Fastify, Stripe, fournisseurs),
  puis `plugins.ts`, chaque fichier de `routes/`, puis `jobs.ts`, par **imports dynamiques attendus
  dans l'ordre** (des imports statiques frères ne s'attendent pas entre eux en présence de top-level
  await : routes enregistrées avant le gestionnaire d'erreurs → 500 au lieu de 400).
- `apps/api/src/routes/*.ts` — une famille de routes par fichier ; `services/*.ts` — logique partagée
  (auth, réservations, remboursements, présentation des événements, textes juridiques).
- `apps/web/src` — `lib/` (formatage, libellés, Stripe), `auth.tsx`, `components/`, `pages/`,
  `pages/admin/` ; `App.tsx` ne contient que le routage (routes secondaires chargées à la demande).
- **Design du site : `apps/web/DESIGN.md` fait foi** (palette bleu nuit / safran, Bricolage Grotesque +
  Hanken Grotesk auto-hébergées, tokens dans `src/styles/tokens.css`). Toujours un token, jamais une
  couleur ou une taille en dur ; icônes Lucide uniquement (jamais d'emoji ni de caractère Unicode
  comme icône) ; photos via `<Picture>` (`components/brand.tsx`) ; pas de sur-titre au-dessus des
  titres. Toute colonne de grille/flex contenant du texte a `min-width:0` / `minmax(0,1fr)`, et un
  contenu qui se charge a un squelette de même taille (pas d'état vide affiché avant les données).
- **Images** : personnes représentatives des musulmans français (majoritairement d'origine
  maghrébine et subsaharienne), aucun alcool à l'image, jamais présentées comme des photos
  d'événements réels ; crédits dans `apps/web/public/images/CREDITS.md`.
- `apps/mobile` — `App.tsx` (navigation racine), `src/screens/`, `src/components/ui.tsx`,
  `src/theme.ts`. Le paiement mobile ouvre la page web `/pay/:id` (pas de SDK Stripe natif).
- Nouveau code : dans le module de son domaine, jamais de retour à un fichier fourre-tout.

## Commandes

```bash
npm run typecheck                         # shared + api + web + mobile
npm run lint                              # ESLint (web, api, shared ; mobile exclu)
npm test                                  # tests unitaires api + mobile
npm run build                             # shared + api + web
npm run typecheck:integration -w @nour/api
```

Tests d'intégration (API) et e2e (web, Playwright) : ils tournent contre une vraie API et une vraie
base. **Toujours une base jetable dédiée**, jamais une base existante dont on n'est pas sûr (plusieurs
conteneurs Postgres d'autres projets tournent sur cette machine) :

```bash
docker run -d --rm --name nour-test-pg -e POSTGRES_USER=nour -e POSTGRES_PASSWORD=nour_dev_password \
  -e POSTGRES_DB=nour_meet -p 127.0.0.1:5499:5432 postgres:17-alpine
export DATABASE_URL="postgresql://nour:nour_dev_password@localhost:5499/nour_meet?schema=public"
npm run db:migrate:deploy && npm run db:seed
(cd apps/api && RATE_LIMIT_MAX=100000 npx tsx src/index.ts &)   # SMS en mode mock, code 123456
npm run test:integration -w @nour/api
(cd apps/web && npx vite --port 5173 &) && (cd apps/web && npx playwright test)
```

Comptes de démonstration (seed) : connexion rapide sur `/login`, téléphones `+336000000xx`
(admin `+33600000001`, restaurateur `+33600000002`), code SMS `123456` en mode mock.

## Git et déploiement

- Branche par sujet, commits en anglais (type conventionnel : `feat(api): …`), merge dans `main`.
- La CI (`.github/workflows/ci.yml`) vérifie types, tests unitaires, build et tests d'intégration
  à chaque push ; un échec de CI se corrige avant tout déploiement.
- Déploiement : `scripts/deploy.sh production|staging`, exécuté **sur le serveur** (migrations
  appliquées au démarrage du conteneur api) — voir `/deployer` et `PRODUCTION.md`.

## Outils Claude du projet (`.claude/`, `.mcp.json`)

- **Hooks** : lecture/modification des `.env` réels et modification d'une migration commitée
  refusées automatiquement ; vérification TypeScript en fin de tour si des `.ts/.tsx` ont changé.
- **Agent `security-reviewer`** : à lancer après toute modification touchant l'authentification,
  les rôles, l'argent ou les données personnelles, et avant un déploiement en production.
- **Commandes** : `/nouvelle-migration` (toute évolution du schéma), `/deployer staging|production`.
- **MCP Sentry** : lecture des erreurs de production pour les diagnostiquer.
- **MCP Stripe** : connecté au compte en **mode test** uniquement ; lecture libre, mais aucune
  action qui déplace de l'argent ou modifie des données (remboursement, annulation, création de
  prix…) sans accord explicite de l'utilisateur dans la conversation.
