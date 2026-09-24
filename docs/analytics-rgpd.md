# Mesure d'audience et consentement

## Choix de l'outil

Nūr Meet utilise **sa propre mesure d'audience** (table `PageView`, tableau de bord dans
Administration → Statistiques), déjà intégrée au produit, plutôt que Google Analytics :

- **RGPD** : données hébergées sur nos serveurs en France, jamais transmises à un tiers, jamais
  croisées avec de la publicité ; pas de transfert hors UE (contrairement à Google Analytics).
- **Coût** : nul (aucun abonnement).
- **Maintenance** : aucune dépendance supplémentaire ; purge automatique après 13 mois
  (`ANALYTICS_RETENTION_DAYS`).
- **Adapté au besoin** : pages vues, sources et campagnes (`utm_*`), entonnoir d'inscription, reliés
  aux vraies données métier (candidatures, ventes) dans le même tableau de bord.

Alternative écartée : Plausible ou Matomo hébergé — conformes, mais un service de plus à payer ou à
maintenir pour des informations que l'outil interne fournit déjà.

## Consentement

La mesure utilise un identifiant aléatoire conservé dans le navigateur : elle est donc soumise au
consentement. Mise en œuvre (`apps/web/src/lib/consent.ts`, `components/CookieConsent.tsx`) :

- rien n'est déposé ni envoyé avant un choix explicite ;
- « Tout accepter », « Tout refuser » et « Personnaliser », le refus aussi simple que l'acceptation ;
- choix mémorisé 6 mois puis redemandé ;
- lien permanent « Gérer mes cookies » dans le pied de page ; un retrait efface immédiatement
  l'identifiant déjà posé.

Côté serveur, `ANALYTICS_ENABLED` (Réglages) permet de couper toute collecte.
