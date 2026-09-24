# Dépendances externes et résilience

Audit du 24 septembre 2026. Principe : **un service secondaire en panne ne fait jamais tomber le
site** — ses erreurs sont capturées au plus près de l'appel, et chaque appel a un délai borné.

| Service | Usage | Si le service est indisponible | Délai / nouvelles tentatives | Version d'API |
|---|---|---|---|---|
| PostgreSQL | Toutes les données | Seule dépendance vitale : `/health/ready` passe en 503 | Pool Prisma borné (`DATABASE_CONNECTION_LIMIT_TOTAL`) | — |
| Stripe | Paiements, abonnements, remboursements | Paiement impossible avec un message clair ; consultation et inscription restent possibles ; un remboursement échoué n'est jamais marqué « remboursé » et les admins sont notifiés | 20 s, 2 nouvelles tentatives réseau (clés d'idempotence automatiques) | Figée par le SDK `stripe` installé ; montée de version délibérée uniquement |
| Twilio Verify | Code SMS de connexion | 503 « service SMS momentanément indisponible » ; aucune autre fonction touchée | 10 s, **aucune** nouvelle tentative (évite deux SMS) | API Verify v2 (URL versionnée) |
| Resend | E-mails de notification | La notification reste visible sur le site (cloche) ; l'envoi est tracé `FAILED` dans l'outbox | 10 s, pas de nouvelle tentative | API REST v1 |
| Anthropic (Claude) | Article quotidien du blog | Nouvelle tentative au passage suivant (30 min), 3 essais par jour au plus, puis publication d'un article de la réserve ; aucun impact sur le reste du site | 10 min par appel, 2 nouvelles tentatives du SDK | Modèle `claude-opus-5` explicite, SDK `@anthropic-ai/sdk` |
| Sentry | Remontée d'erreurs | Rien : le SDK n'est chargé que si un DSN est configuré, un échec est ignoré | — | — |
| Let's Encrypt (Caddy) | Certificats HTTPS | Caddy réessaie seul ; le certificat en cours reste valable | Automatique | — |

Réponses validées : l'article généré par l'IA est contrôlé avant publication (sources limitées aux
URL réellement renvoyées par la recherche web, liens internes limités aux vraies pages, images de la
photothèque, graphiques sourcés) ; les webhooks Stripe sont vérifiés par signature.

Surveillance : `GET /health` (sonde de vie Docker) et `GET /health/ready` (base + état de
configuration de chaque fournisseur, sans aucun secret). Les erreurs 5xx partent vers Sentry si
`SENTRY_DSN` est défini.

Les serveurs MCP configurés dans `.mcp.json` (Sentry, Stripe) servent uniquement aux sessions de
développement assisté : aucune fonction de production n'en dépend.
