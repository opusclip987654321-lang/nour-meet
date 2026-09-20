# Mise en production — état et procédure

Ce document rassemble tout ce qui a été préparé pour la mise en production (infrastructure,
sécurité, sauvegardes, e-mails, surveillance, documents juridiques), ce qui reste bloqué par un
achat ou une validation, et les instructions exactes pour débloquer chaque point. Rien de ce qui
suit n'a modifié de DNS réel, provisionné de serveur, ni basculé Stripe en mode LIVE.

## 1. Après l'achat du VPS OVHcloud (VPS-2, France)

Fournir à l'assistant, ou suivre soi-même :
1. L'adresse IP publique du serveur.
2. Un accès SSH (utilisateur + clé publique à autoriser, ou mot de passe initial à changer).
3. Confirmation que Docker et Docker Compose sont installés (sinon : `curl -fsSL
   https://get.docker.com | sh`, procédure officielle Docker).

Puis, sur le serveur :
```
git clone <url-du-dépôt> nour-v2 && cd nour-v2
cp .env.production.example .env      # puis remplir chaque valeur, voir section 5
./scripts/deploy.sh production
```
`deploy.sh` construit les images, applique les migrations, démarre les conteneurs et vérifie
`/health` avant de considérer le déploiement réussi (voir scripts/deploy.sh pour le détail).

## 2. Après confirmation du domaine nourmeet.com chez OVHcloud

Ajouter, dans la zone DNS OVHcloud de nourmeet.com, une fois le serveur prêt :

| Type | Nom | Valeur |
|---|---|---|
| A | `@` (nourmeet.com) | IP publique du VPS |
| A | `www` | IP publique du VPS |
| A | `api` | IP publique du VPS |

`infra/Caddyfile` (servi par le conteneur `caddy` de `docker-compose.prod.yml`) obtient alors
automatiquement un certificat HTTPS Let's Encrypt pour les trois domaines et redirige
`www.nourmeet.com` vers `nourmeet.com`. Aucun enregistrement MX existant n'est à toucher pour
cette étape.

## 3. Twilio Verify (SMS de connexion)

Une fois le compte Twilio activé, renseigner dans `.env` (production) et `.env.staging` :
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, et `SMS_MODE=twilio`.
Le mode `mock` est refusé par le code lui-même dès que `NODE_ENV=production` (voir
`apps/api/src/env.ts`) : il est structurellement impossible de déployer en production avec de
faux codes SMS.

Déjà fait et testé (voir section 6) : gestion d'erreur distincte pour quota dépassé (429), panne
Twilio (503) et code faux (échec silencieux, jamais une exception) ; limitation contre les abus
déjà en place sur `/auth/request-otp` et `/auth/verify-otp` (3 et 10 tentatives / 10 minutes en
mode Twilio, au lieu de 100 en mode mock).

## 4. Documents juridiques

Cinq projets de texte sont en ligne dès maintenant sur `/legal/mentions-legales`, `/legal/cgu`,
`/legal/cgv`, `/legal/confidentialite`, `/legal/cookies` (voir `apps/web/src/legal.tsx`), chacun
avec son propre bandeau « À COMPLÉTER ET À VALIDER » et sa liste précise d'informations
manquantes (identité de société, SIRET, adresse, contact RGPD, médiateur de la consommation...).
**Ne pas ouvrir commercialement au public avant leur validation.**

## 5. Stripe

Le mode reste TEST tant que vous ne donnez pas d'accord explicite pour LIVE. Checklist TEST
vérifiée réellement le 2026-09-20 (voir le rapport de session pour le détail) : création de
PaymentIntent, paiement réussi avec webhook signé authentique (Stripe CLI), génération du billet,
carte refusée gérée sans fausse confirmation, annulation avec remboursement automatique réel
vérifié côté Stripe, alertes admin qui réagissent en temps réel. **Pour basculer en LIVE un jour :
remplacer `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`VITE_STRIPE_PUBLISHABLE_KEY` par les
clés live, et me redemander confirmation avant de le faire — je ne le ferai jamais de moi-même.**

## 6. Resend (e-mails transactionnels)

Déjà implémenté et branché génériquement : chaque notification importante (inscription,
confirmation de place, billet, rappel, décision d'entretien, abonnement restaurateur...) part
aussi par e-mail dès que `RESEND_API_KEY` et `RESEND_FROM_EMAIL` sont renseignés (voir
`apps/api/src/index.ts`, fonction `notify`, et `apps/api/src/email-provider.ts`, 5 tests
unitaires). Sans ces deux valeurs, l'envoi reste simulé (aucun envoi réel, aucun crash).

**Ne jamais utiliser l'adresse de la messagerie professionnelle OVH du domaine principal comme
expéditeur transactionnel.** Utiliser un sous-domaine dédié, par exemple
`notifications@mail.nourmeet.com` :
1. Ajouter ce domaine (`mail.nourmeet.com`, pas `nourmeet.com`) dans le tableau de bord Resend.
2. Resend affiche alors les enregistrements exacts à ajouter (des TXT SPF/DKIM et un enregistrement
   DMARC), à créer chez OVHcloud UNIQUEMENT sur ce sous-domaine — cela ne touche jamais le MX ni le
   SPF du domaine principal `nourmeet.com`, donc la messagerie existante continue de fonctionner
   normalement.
3. Ne valider ces enregistrements chez OVH qu'une fois prêt : Resend attend cette étape avant
   d'autoriser l'envoi depuis ce sous-domaine.

## 7. Sentry (surveillance d'erreurs)

Déjà implémenté (`apps/api/src/sentry.ts`, `apps/web/src/sentry.ts`), inactif tant que
`SENTRY_DSN`/`VITE_SENTRY_DSN` ne sont pas fournis. Vérifié que le code Sentry ajoute 0 octet au
site public tant qu'il est désactivé, et qu'il ne transmet jamais les jetons de connexion, mots de
passe, moyens de paiement ni identité précise d'un utilisateur — seules les vraies erreurs
serveur (5xx) sont transmises, jamais les erreurs de saisie (400/401/403/404/409).

Pour l'activer (formule gratuite) : créer un compte sur sentry.io, créer un projet Node.js
(API) et un projet React (web), copier chaque DSN dans `.env`.

## 8. Sauvegardes PostgreSQL

`scripts/backup-db.sh` (à brancher sur un cron quotidien) + `scripts/restore-db.sh`. Le cycle
complet a été réellement testé le 2026-09-20 : sauvegarde de la base réelle, restauration dans un
conteneur PostgreSQL isolé, comptages de lignes identiques avant/après sur User/Event/Application
— pas seulement écrit, vraiment exécuté.

Pour l'externalisation (recommandée, protège d'une panne du serveur lui-même) :
1. Créer un espace de stockage objet OVHcloud (Object Storage, compatible S3), ou tout autre
   fournisseur S3/Swift.
2. `apt install rclone` sur le serveur, puis `rclone config` (une seule fois).
3. Définir `RCLONE_REMOTE` (ex. `RCLONE_REMOTE=ovh:nour-meet-backups`) avant d'appeler
   `backup-db.sh`, ou l'exporter dans le crontab.

## 9. Séparation dev / staging / production

- `docker-compose.yml` (dev) : données de démonstration réamorcées à chaque démarrage.
- `docker-compose.staging.yml` + `.env.staging` : mêmes garde-fous que la production, base et
  volumes séparés, accessible via tunnel SSH par défaut (`ssh -L 8081:localhost:8081 -L
  4001:localhost:4001 utilisateur@serveur`).
- `docker-compose.prod.yml` + `.env` : données réelles, seul environnement exposé publiquement
  (via Caddy).

## 10. Déploiement et retour arrière

```
./scripts/deploy.sh production     # ou staging
./scripts/rollback.sh production   # revient à la dernière version qui fonctionnait
```
`deploy.sh` refuse de démarrer si le dépôt a des modifications non commitées, note la version
précédente avant de basculer, et vérifie `/health` avant de déclarer le déploiement réussi. En cas
d'échec, il indique directement la commande de retour arrière à exécuter.

## 11. Pull request

Une pull request documentée de `fix/nour-v2-parcours-recette-20260920` vers `main` a été préparée
avec le détail complet des changements et des résultats de tests. **Elle ne sera fusionnée
qu'après votre accord explicite.**
