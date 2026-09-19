# Nūr Meet

Plateforme complète d’événements privés : site public, espace participant, administration, API Node.js, base PostgreSQL et application mobile React Native.

## Contenu du projet

- `apps/web` — site React/Vite responsive et administration.
- `apps/mobile` — application iOS/Android avec Expo et React Native.
- `apps/api` — API Node.js/Fastify commune au web et au mobile, authentification SMS, Prisma et PostgreSQL.
- `packages/shared` — types partagés.
- `docker-compose.yml` — PostgreSQL, API et site web.

## Démarrage recommandé avec Docker

Prérequis : Docker Desktop ouvert.

```bash
docker compose up --build
```

Puis ouvrir :

- Site web : <http://localhost:5173>
- API : <http://localhost:4000/health>
- Base PostgreSQL : accessible par l’API dans le réseau Docker.

Les données de démonstration sont ajoutées automatiquement.

## Comptes de démonstration

En configuration locale par défaut (`SMS_MODE=mock`), aucun SMS n’est envoyé et le code affiché après la demande est `123456`. Dans ce mode, la page de connexion affiche aussi des boutons de connexion en un clic vers un compte de test par état (administrateur, modérateur, personnel d'accueil, restaurateur approuvé/en attente, participant validé/non validé par catégorie, profil refusé, entretien en attente, plus un compte jamais inscrit généré à la volée) — voir `apps/api/prisma/seed.ts` pour la liste complète des numéros.

| Rôle | Téléphone |
|---|---|
| Participant — Sofia | `+33612345678` |
| Administrateur — Walid | `+33600000001` |
| Organisateur — Maison Amana | `+33600000002` |

## Paiement (Stripe, mode test)

Le paiement utilise Stripe (PaymentIntents + Elements) en mode test — voir `.env.example` pour les variables `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` et `VITE_STRIPE_PUBLISHABLE_KEY`. En local, les webhooks doivent être relayés avec `stripe listen --forward-to localhost:4000/webhooks/stripe`.

Cartes de test Stripe (date d'expiration future quelconque, CVC à 3 chiffres quelconque) :

- Paiement réussi : `4242 4242 4242 4242`.
- Paiement refusé : `4000 0000 0000 0002`.

Le billet et le QR code ne sont générés qu'après confirmation du paiement par le webhook Stripe.

## Application mobile

Une fois PostgreSQL et l’API lancés :

```bash
npm install
npm run dev:mobile
```

Sur le simulateur iOS, `http://localhost:4000` fonctionne directement. Sur un téléphone réel, créer `apps/mobile/.env` :

```env
EXPO_PUBLIC_API_URL=http://ADRESSE_IP_DU_MAC:4000
```

Le Mac et le téléphone doivent utiliser le même réseau Wi-Fi.

## Authentification SMS : simulation ou Twilio

Le web et l’application mobile utilisent les mêmes routes de l’API et le même compte utilisateur.

### Développement gratuit

Le mode par défaut ne contacte pas Twilio :

```env
NODE_ENV=development
SMS_MODE=mock
DEV_OTP_CODE=123456
```

Le code de développement n’est renvoyé par l’API et affiché dans l’interface que dans ce mode.

### Tester de vrais SMS avec Twilio Verify

1. Créer un service dans Twilio Verify.
2. Copier `.env.example` vers `.env` à la racine.
3. Renseigner les valeurs suivantes sans jamais les publier dans Git :

```env
NODE_ENV=development
SMS_MODE=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Puis reconstruire l’API :

```bash
docker compose up --build
```

Pour revenir au mode gratuit, remettre `SMS_MODE=mock` puis redémarrer Docker. Le serveur refuse volontairement de démarrer avec `NODE_ENV=production` et `SMS_MODE=mock`.

Les routes d’envoi et de vérification sont limitées en fréquence afin de réduire les abus et les envois payants. Pour un déploiement avec plusieurs serveurs, brancher cette limitation sur Redis.

## Démarrage sans Docker

Il faut disposer d’un serveur PostgreSQL local et créer la base `nour_meet`.

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

## Migrations de base de données

Le schéma est versionné avec de vraies migrations Prisma (`apps/api/prisma/migrations/`), plus gérées par `prisma db push`.

- Développement (crée une nouvelle migration à partir des changements de `schema.prisma`) : `npm run db:migrate`.
- Déploiement (applique les migrations déjà créées, utilisé par Docker et en production) : `npm run db:migrate:deploy`.

Pour toute nouvelle colonne obligatoire sur une table déjà peuplée : ajouter d'abord la colonne en nullable ou avec une valeur par défaut, migrer les données existantes, puis ajouter la contrainte dans une migration séparée — jamais en une seule étape qui casserait les données en place.

## Paramètres applicatifs (`AppSetting`)

Les valeurs configurables (durée du verrou de paiement, quota mensuel restaurateur, drapeaux de fonction comme `ENABLE_GENDER_PRICING` ou `MARKETPLACE_PAYOUTS_ENABLED`...) sont centralisées dans la table `AppSetting` plutôt qu'en dur dans le code — voir `apps/api/src/settings.ts` pour la liste complète, les valeurs par défaut et leur description. Un administrateur peut les consulter (`GET /admin/settings`) et les modifier (`PATCH /admin/settings/:key`) sans redéploiement ; chaque modification est validée et journalisée dans `AuditLog`.

## Fonctions opérationnelles

- Connexion par téléphone avec mode local gratuit ou véritables codes Twilio Verify.
- Profils privés et profil validé.
- Catalogue, filtres et fiches événements.
- Deux parcours distincts et centralisés par `Event.flow` : speed dating à sélection (entretien global une seule fois, jamais par événement, avec délai de trois mois après un refus) et networking à accès direct (aucune validation de profil requise).
- Questionnaire structuré obligatoire avant toute candidature (7 questions privées en speed dating, 7 questions non bloquantes en networking).
- Aucune place n'est retenue à la candidature : un verrou technique court (10 min par défaut, `AppSetting PAYMENT_LOCK_MINUTES`) n'est posé qu'au moment réel d'une tentative de paiement.
- Paiement réel Stripe (mode test) avec webhook, protection contre la survente sur paiement tardif.
- Politique d'annulation/remboursement calculée et exécutée côté serveur (plus de 24h : remboursement intégral automatique ; 24h ou moins : aucun remboursement de plein droit, sauf exception admin motivée).
- Tarifs différenciés par catégorie et prestations réelles par événement.
- Abonnement mensuel restaurateur (100 €/mois par défaut, quota d'événements publiables par mois) remplaçant la commission 30/70 ; l'ancien registre 30/70 reste en base mais n'est plus utilisé par défaut (`AppSetting ENABLE_COMMISSION_LEDGER`).
- Minimum de participants par événement avec date limite de décision et notification automatique du restaurateur.
- Scaffolding marketplace (comptes Stripe Connect en mode test) préparé mais aucun virement réel n'est jamais déclenché (`AppSetting MARKETPLACE_PAYOUTS_ENABLED`, désactivé par défaut, bloqué par validation juridique).
- Partage attribué « J'y vais, viens avec moi » avec statistiques de conversion admin, témoignages modérés, page « Le concept » et blog éditorial (brouillons manuels ou générés par IA, toujours validés par un administrateur avant publication — jamais automatique).
- Billet et QR code unique.
- Contrôle d’entrée et protection contre le double scan.
- Liste d’attente.
- QR personnel, recherche d’un profil et demande de contact.
- Messagerie après acceptation.
- Blocage et signalement.
- Notifications, boîte d’envoi (SMS toujours simulé, e-mail réel via Resend si configuré, sinon simulé) et fidélité.
- Rôles participant, organisateur, modérateur, accueil et administrateur.
- Journal des actions sensibles.

## Inspecter la base de données

```bash
docker compose run --rm -p 5555:5555 api npx prisma studio --hostname 0.0.0.0 --port 5555
```

Ouvrir ensuite <http://localhost:5555>. Prisma Studio permet de consulter les utilisateurs, événements, paiements, billets, messages et signalements.

## Passage en production

La connexion SMS prend déjà en charge Twilio Verify, le paiement utilise déjà Stripe en mode test et l'e-mail réel via Resend est déjà câblé (voir plus haut). Pour une ouverture au public : activer `NODE_ENV=production`, `SMS_MODE=twilio`, renseigner de vraies clés Stripe/Resend, changer `JWT_SECRET` (le serveur refuse de démarrer en production avec la valeur par défaut), déployer les migrations avec `npm run db:migrate:deploy` (jamais `db push`) et activer HTTPS. Les paramètres `ENABLE_GENDER_PRICING` et `MARKETPLACE_PAYOUTS_ENABLED` (table `AppSetting`, désactivés par défaut) sont réservés à des fonctions à venir et ne doivent être activés qu'après validation juridique correspondante.
