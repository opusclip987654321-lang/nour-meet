# Données de démonstration (lancement)

Quelques restaurants et soirées pour que le site ne paraisse pas vide au lancement. Ils s'affichent
exactement comme de vrais restaurants et de vraies soirées — aucune mention « démo » ou « test » —
mais **aucun paiement n'est possible** : l'API refuse toute tentative (`POST
/applications/:id/payment-intent`) avec le message « Cet événement n'est actuellement pas
réservable ». Ils ne sont ni dans le sitemap ni dans `llms.txt`, portent `noindex` et aucune donnée
structurée `Event`, et ne sont jamais proposés comme alternative à un vrai événement.

## Identification

`User.isDemo = true`, `Restaurant.isDemo = true` (table `Organizer`), `Event.isDemo = true`.
Garde-fous : noms d'établissement fictifs, quartier seulement (aucune adresse postale), aucun
SIRET, téléphones pris dans la plage 06 39 98 xx xx réservée par l'ARCEP à la fiction.

## Installer / mettre à jour (production)

```bash
docker compose -f docker-compose.prod.yml exec api npm run prisma:seed:demo
```

Idempotent (clés : téléphone et slug). Les dates sont recalculées à partir du jour d'exécution.

## Tout supprimer plus tard

Demander « Supprime toutes les données de démonstration » : il suffit de supprimer, dans cet ordre,
les événements `isDemo`, puis les restaurants `isDemo`, puis les comptes `isDemo`. Les candidatures
éventuellement déposées par de vrais utilisateurs sur ces soirées sont supprimées en cascade avec
l'événement (aucun paiement ne peut y être rattaché).
