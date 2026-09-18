# Rapport de vérification — Nūr Meet

Date : 17 septembre 2026

## Vérifications réussies

- Génération du client Prisma depuis le schéma PostgreSQL.
- Vérification TypeScript de l’API Node.js.
- Vérification TypeScript du site React.
- Vérification TypeScript de l’application React Native.
- Compilation de production de l’API.
- Compilation de production du site web avec Vite.
- Export du bundle iOS avec Expo/Metro : 596 modules intégrés.
- Dix tests automatisés :
  - paiement accepté ou refusé en mode test ;
  - prévention de la survente ;
  - prévention du double scan ;
  - délai de paiement de 24 heures ;
  - normalisation des numéros français au format international ;
  - validation du code SMS local ;
  - construction de la requête Twilio Verify ;
  - validation du statut Twilio `approved`.
- Vérification que le serveur refuse `SMS_MODE=mock` en production.
- Vérification que le mode local accepte les variables Twilio laissées vides par Docker Compose.
- Validation syntaxique du fichier Docker Compose et de ses trois services : PostgreSQL, API et Web.
- Validation du fichier de configuration Expo iOS/Android.

## Vérification à effectuer sur l’ordinateur de destination

Le moteur Docker n’est pas présent dans l’environnement ayant servi à générer le projet. Le démarrage réel des trois conteneurs n’a donc pas pu être exécuté ici.

Sur le Mac de destination :

```bash
docker compose up --build
```

Puis vérifier :

1. `http://localhost:4000/health` renvoie un statut `ok`.
2. `http://localhost:5173` affiche l’accueil Nūr Meet.
3. La connexion avec `+33612345678` et `123456` ouvre l’espace participant.
4. La connexion avec `+33600000001` et `123456` ouvre l’administration.
5. Le billet `NOUR-TICKET-DEMO-482` est accepté une seule fois par le scanner.
6. Prisma Studio affiche les données avec `docker compose run --rm -p 5555:5555 api npx prisma studio --hostname 0.0.0.0 --port 5555`.
7. En mode Twilio, un véritable SMS arrive sur un numéro autorisé et son code ouvre le même compte depuis le web et le mobile.

## Limites de la vérification

L’intégration Twilio Verify est implémentée et testée avec un serveur HTTP simulé. Un envoi réel ne peut être validé qu’après ajout des trois identifiants du compte Twilio du propriétaire. Les paiements et les e-mails restent simulés ; aucun prélèvement réel n’est effectué.
