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

En configuration locale par défaut (`SMS_MODE=mock`), aucun SMS n’est envoyé et le code affiché après la demande est `123456`.

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

## Fonctions opérationnelles

- Connexion par téléphone avec mode local gratuit ou véritables codes Twilio Verify.
- Profils privés et profil validé.
- Catalogue, filtres et fiches événements.
- Candidature et choix du créneau d’appel.
- Acceptation/refus dans l’administration.
- Réservation temporaire de 24 heures.
- Paiement simulé réussi ou refusé.
- Billet et QR code unique.
- Contrôle d’entrée et protection contre le double scan.
- Liste d’attente.
- QR personnel, recherche d’un profil et demande de contact.
- Messagerie après acceptation.
- Blocage et signalement.
- Notifications, boîte d’envoi SMS/e-mail de test et fidélité.
- Rôles participant, organisateur, modérateur, accueil et administrateur.
- Journal des actions sensibles.

## Inspecter la base de données

```bash
docker compose run --rm -p 5555:5555 api npx prisma studio --hostname 0.0.0.0 --port 5555
```

Ouvrir ensuite <http://localhost:5555>. Prisma Studio permet de consulter les utilisateurs, événements, paiements, billets, messages et signalements.

## Passage en production

La connexion SMS prend déjà en charge Twilio Verify. Pour une ouverture au public, activer `NODE_ENV=production`, `SMS_MODE=twilio`, remplacer le paiement et les e-mails simulés, modifier `JWT_SECRET`, activer HTTPS et réaliser les vérifications juridiques et de sécurité prévues.
