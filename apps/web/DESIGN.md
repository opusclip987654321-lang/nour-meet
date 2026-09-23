# Nour Meet — direction artistique et design system (site web)

Source de vérité visuelle du site `apps/web`. Les valeurs vivent dans `src/styles/tokens.css` ;
ce document explique les décisions. Toute nouvelle page part d'ici, jamais d'un copier-coller de
CSS d'une autre page.

## Thèse

**Une place à table, à Paris, entre personnes qui partagent vos valeurs.** Nour Meet n'est pas une
application de rencontre à swiper : ce sont des soirées en petit comité dans des restaurants
partenaires, avec une sélection sérieuse et un contact qui ne s'ouvre que si les deux le veulent.
Le design doit montrer ce mécanisme (la table, le lieu, la vérification, le consentement), pas une
ambiance de luxe générique.

- **Nūr = la lumière.** Traduite par un accent safran, chaud et lumineux, posé sur un bleu nuit :
  la lumière qu'on apporte à une soirée. Pas de lanterne, pas de croissant, pas de calligraphie,
  pas d'arche : aucune imagerie religieuse ou orientalisante.
- **Le public** : des adultes musulmans en France, urbains, actifs, majoritairement d'origine
  maghrébine et subsaharienne, femmes voilées ou non. Ton sérieux, chaleureux, jamais
  paternaliste. La religion n'est jamais nommée dans le site (choix produit déjà présent côté API) :
  on parle de valeurs partagées, de respect et de cadre.

## Modes (vocabulaire Impeccable)

- **Persuader** : accueil, concept, catalogue, fiche événement → voix affirmée, photos, typographie
  d'affichage.
- **Opérer** : connexion, espace participant, espace restaurateur, administration → sobriété,
  lisibilité, densité maîtrisée ; la marque vit dans les détails (couleurs, focus, boutons).
- **Lire** : blog, pages juridiques → mesure de 65 à 72 caractères, hiérarchie nette.

## Couleur — stratégie « engagée » sur les surfaces Persuader, « retenue » sur Opérer

Le noir et or précédent était le réflexe de catégorie « premium ». Le mode clair est choisi pour la
scène d'usage réelle : on découvre et on réserve une soirée en journée, souvent sur téléphone,
et la confiance passe par la clarté.

| Rôle | Valeur | Usage |
|---|---|---|
| `--night` | `#1C2653` | Bleu nuit : bandeau d'accueil, pied de page, boutons principaux sur fond clair |
| `--night-2` | `#2A3670` | Survol et surfaces nuit secondaires |
| `--saffron` | `#F2A33A` | La lumière : appel à l'action principal sur fond nuit, repères, macron du logo |
| `--saffron-ink` | `#8A4B00` | Safran lisible sur fond clair (liens d’accent, petits textes) — 6,8:1 |
| `--canvas` | `#F6F6F8` | Fond de page (gris zinc froid, jamais crème) |
| `--surface` | `#FFFFFF` | Cartes, panneaux, champs |
| `--ink` | `#15171C` | Texte principal — 17,9:1 sur blanc |
| `--ink-2` | `#474C58` | Texte secondaire — 8,6:1 |
| `--ink-3` | `#687080` | Texte tertiaire, métadonnées — 5:1 sur blanc, 4,6:1 sur le fond (plancher AA) |
| `--line` | `#E1E3E8` | Bordures |
| `--success` | `#1D7A4C` / fond `#E7F4EC` | Confirmé, validé (4,7:1) |
| `--warning` | `#9A5B00` / fond `#FFF3DD` | À faire, en attente |
| `--danger` | `#B3261E` / fond `#FCE9E7` | Erreur, annulation |
| `--rencontre` | `#B0406A` | Catégorie Speed dating (texte sur fond clair, 5,5:1) |
| `--networking` | `#1F6F8B` | Catégorie Networking (5,6:1) |

Sur fond nuit : texte `#FFFFFF`, secondaire `#C8CDE4` (9,2:1), safran pour l’accent (6,9:1).

## Typographie — deux familles auto-hébergées

- **Bricolage Grotesque** (variable, OFL) pour l'affichage et les titres : une grotesque
  chaleureuse, un peu irrégulière, humaine — tout le contraire de la serif « luxe » (Playfair
  Display, abandonnée, fait partie des polices par défaut que la méthode Impeccable demande
  d'éviter).
- **Hanken Grotesk** (variable, OFL) pour le texte et l'interface : très lisible en petit, neutre
  sans être froide.
- Auto-hébergées via `@fontsource-variable` : aucune requête vers Google (RGPD), pas de décalage
  au chargement (`font-display: swap` + repli métriquement proche).

| Rôle | Taille | Graisse / interlignage |
|---|---|---|
| Display | `clamp(2.375rem, 1.5rem + 3.4vw, 4rem)` | Bricolage 700 / 1.02, tracking -0.03em |
| H1 | `clamp(2rem, 1.5rem + 2.2vw, 3.25rem)` | Bricolage 700 / 1.08 |
| H2 | `clamp(1.625rem, 1.3rem + 1.4vw, 2.375rem)` | Bricolage 650 / 1.12 |
| H3 | `1.25rem` | Bricolage 600 / 1.3 |
| Corps large | `1.125rem` | Hanken 400 / 1.6 |
| Corps | `1rem` (plancher) | Hanken 400 / 1.6 |
| Petit | `0.875rem` | Hanken 400 / 1.5 |
| Libellé | `0.8125rem` | Hanken 600 / 1.3 — jamais en capitales espacées au-dessus d'un titre |
| Bouton | `1rem` | Hanken 600 |

Aucun texte d'interface sous 13 px. Pas de sur-titre (« eyebrow ») au-dessus des titres : le titre
porte son propre poids.

## Espace, formes, profondeur

- Échelle d'espacement (base 4 px) : 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 (`--s-1` … `--s-10`).
  Plus d'espace au-dessus d'un titre qu'en dessous.
- Rayons : 8 (champs, puces), 14 (cartes), 22 (médias larges), 999 (pastilles).
- Ombres : décalées et douces, teintées bleu nuit, jamais de halo coloré centré ni d'ombre dure.
- Conteneur : 1200 px max, gouttière `clamp(16px, 4vw, 40px)`.
- Points de rupture : 480, 768, 1024, 1280. Mobile d'abord.

## Composants (classes réutilisables, `src/styles/components.css`)

`button` (+ `secondary`, `ghost`, `danger`, `small`, `full`), `field`/`input`/`select`/`textarea`,
`card`, `panel`, `badge` et `category-badge`, `chip`, `avatar`, `tabs`, `modal`, `notice`
(alertes), `empty`, `skeleton`, `spinner`, `table` responsive, `stat`.

- Zones tactiles ≥ 44 px ; focus visible (anneau safran 3 px + décalage) sur tout élément actif.
- Icônes : **Lucide** uniquement (trait 1,75, taille 18/20), jamais de caractères Unicode (◆ ● ◇ ✓ →)
  ni d'emoji comme icône.
- Pas de bordure colorée sur un seul côté des cartes, pas de cartes imbriquées, pas de dégradé
  dans le texte, pas de verre dépoli décoratif.

## Images

- Photos réelles, lumière naturelle, **aucun alcool à l'image**, personnes qui ressemblent au
  public (voir la section Thèse) ; lieux parisiens identifiables (terrasses, bistrots).
- Crédits et licences : `public/images/CREDITS.md`. Ce sont des illustrations d'ambiance,
  jamais présentées comme des photos d'événements Nour Meet.
- Livrées en AVIF + WebP, 640/1024/1600 px, via le composant `Picture` (`srcset`, `sizes`,
  `width`/`height` pour réserver la place, `loading="lazy"` sauf l'image principale).
- Texte sur photo : flou progressif (porté de MagicUI « Progressive Blur ») plutôt qu'un voile noir.

## Mouvement

Transitions de 150 à 220 ms, `cubic-bezier(.2,.7,.2,1)` ; aucun rebond. Un seul moment soigné par
page. `prefers-reduced-motion: reduce` coupe toute animation non essentielle.

## Ton et rédaction

Concret, vérifiable, en « vous ». Chaque titre dit ce qui se passe réellement (qui, où, comment).
Aucun chiffre, avis ou membre inventé. Les mécanismes de confiance cités sont ceux qui existent
dans le produit : numéro vérifié par SMS, entretien de validation pour les rencontres, badge
Vérifié, contact seulement si les deux acceptent, signalement et modération, coordonnées jamais
transmises aux restaurants, paiement Stripe, annulation gratuite jusqu'à 24 h.
