# Rapport de vérification — Nūr Meet

Dernière mise à jour : 19 septembre 2026 (Lot 0 du cahier des charges v3 — baseline et migrations versionnées).

## Vérifications automatisées exécutées à chaque lot

- `npm run typecheck` (workspaces `@nour/api`, `@nour/web`, `@nour/mobile`, `@nour/shared`) : succès.
- `npm test` (`@nour/api`, unitaires) : 14 tests, succès.
- `npm run -w @nour/api test:integration` (contre le vrai serveur de développement Docker + PostgreSQL réel) : 7 tests, succès — rôle/suspension vérifiés en direct, isolation entre restaurateurs, entretien global (porte d'entrée + délai de trois mois), atomicité des quotas sous concurrence réelle, tarification différenciée, absence de survente sur paiement Stripe tardif.
- `npm run build` (shared → api → web) : succès.
- `npx prisma migrate status` : à jour, aucune dérive entre `schema.prisma` et les migrations versionnées.
- Démarrage réel `docker compose up --build` (PostgreSQL, API, Web) : vérifié, `prisma migrate deploy` s'exécute sans erreur au démarrage du conteneur API, `/health` répond `ok`.

## État fonctionnel réel (au-delà du commit initial)

Le rapport précédent datait du commit initial et ne reflétait aucune des phases réalisées depuis. État réel actuel :

- Authentification par téléphone : mode local gratuit (`SMS_MODE=mock`) ou Twilio Verify réel — inchangé, testé.
- Entretien global de validation du profil (une démarche par personne, pas par événement), avec délai de trois mois avant nouvelle demande après refus.
- Paiement **réel** Stripe (PaymentIntents + Elements), webhook signé, protection testée contre la survente sur paiement reçu après expiration de la réservation.
- Tarification différenciée par catégorie (HOMME/FEMME) et prestations réelles par événement, galerie photo.
- Comptabilité 30/70 restaurateur avec reversements et remboursements sur demande admin (aucun virement automatique).
- Propositions d'événements alternatifs par région avec vérification de place réelle disponible.
- Scanner de billets par caméra réelle (`jsqr` côté web, `expo-camera` côté mobile) et protection contre le double scan.
- E-mail réel via Resend si configuré, sinon simulé (jamais affiché comme envoyé avant confirmation du fournisseur).
- `JWT_SECRET` : le serveur refuse de démarrer en production avec la valeur par défaut.
- Comptes de test par persona + connexion rapide en un clic sur la page de connexion, visibles uniquement en mode SMS simulé.
- Base de données gérée par de vraies migrations Prisma versionnées (`apps/api/prisma/migrations/`), plus par `db push`.
- Paramètres applicatifs centralisés dans `AppSetting` (voir `apps/api/src/settings.ts`), modifiables par un administrateur sans redéploiement.

## Écart connu : application mobile

`apps/mobile` n'a pas suivi les évolutions ci-dessus (encore l'ancien flux de candidature sans entretien global, sans tarification différenciée, sans galerie). Écart identifié dans l'audit du cahier des charges v3 ; à combler progressivement, lot par lot, uniquement sur les parcours qui doivent être mobiles.

## Limites de la vérification

Les paiements et e-mails utilisent des modes test/sandbox réels (Stripe test mode, Resend si clé fournie) ; aucun encaissement ni envoi réel non-test n'est déclenché sans clé de production explicitement fournie. L'intégration Twilio Verify reste testée avec un serveur HTTP simulé ; un envoi réel nécessite les identifiants du compte Twilio du propriétaire.
