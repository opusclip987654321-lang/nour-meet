# HTTPS, cookies et secrets — audit du 24 septembre 2026

## HTTPS

- Production : Caddy (`infra/Caddyfile`) obtient et renouvelle les certificats Let's Encrypt et
  redirige automatiquement HTTP → HTTPS ; `www` redirige vers le domaine principal ; HSTS
  (2 ans, sous-domaines) posé par Caddy et par nginx.
- Aucune ressource chargée en HTTP : polices et images auto-hébergées, API appelée via
  `VITE_API_URL` (HTTPS en production), Stripe en HTTPS.
- Local : HTTP simple inchangé (Vite 5173, API 4000).

## Cookies et session

Le site ne pose aucun cookie applicatif : la session est un jeton porté dans l'en-tête
`Authorization` (stocké dans le navigateur), jamais envoyé automatiquement à un autre site — pas de
risque CSRF par cookie. Côté API : CORS limité à `WEB_ORIGIN`, en-têtes Helmet, rate-limit global
et renforcé sur la connexion. Les cookies éventuels de Stripe (formulaire de carte) sont posés par
Stripe sur son propre domaine, nécessaires au paiement.

## Secrets

- Vérifié : aucune clé privée dans l'historique Git (recherche des motifs `sk_live_`, `sk_test_`,
  `whsec_`, `re_…`, `AC…`/`VA…` Twilio, `sk-ant-`), ni dans le bundle navigateur construit.
- `.env` et `.env.*` sont ignorés par Git, sauf les fichiers `*.example` sans valeur.
- Secrets serveur uniquement : `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `TWILIO_*`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `DATABASE_URL`.
- Exposées au navigateur **par conception** (préfixe `VITE_`) : `VITE_STRIPE_PUBLISHABLE_KEY`
  (clé publiable, ne permet aucun débit), `VITE_SENTRY_DSN` (identifiant d'envoi d'erreurs, prévu
  pour être public), `VITE_API_URL` et `VITE_SITE_URL` (adresses publiques).
- Journaux : les erreurs du fournisseur SMS sont journalisées sans numéro ni identifiant ; Sentry
  retire en-têtes, cookies et jeton de session avant envoi ; l'API ne journalise jamais les en-têtes
  `Authorization`.
