# Loop grand public de Nūr Meet

Consigne de la revue hebdomadaire (Claude Code sur le VPS, choix de louis du 19/10). Courte exprès :
objectif, règles fixes, leviers, pistes, rien de plus.

## Avant de décider

Relire `loop/LECONS.md` : ne pas refaire un essai déjà raté sans raison nouvelle. Un essai à la fois
quand c'est possible. Données trop maigres : ne rien changer et le noter.

Relire le résultat des publications de la semaine (bloc « Réseaux » de la page Nūr Meet du cerveau, ou
colonnes `instagramError` / `facebookError` des articles) : le cerveau y explique chaque échec (code Meta)
et dit qui agit. Cause « loop » (image, format, légende, article trop court) : la corriger ; cause
« attendre » : ne pas multiplier les essais ; cause « louis » : le cerveau l'a déjà prévenu. Aucun e-mail
n'est envoyé pour une publication réussie ou échouée (louis, 21/10/2026).

## Objectif

Des particuliers (networking, rencontres amoureuses) qui découvrent le site, créent un compte,
candidatent et paient leur place à une soirée. Chiffres : bloc « Grand public » de la page Nūr Meet du
cerveau (tunnel sur 30 jours, réseaux, soirées, origine des visiteurs), lu dans la base chaque heure.

## Règles fixes

- Les règles de `CLAUDE.md` s'appliquent (18 ans et plus, aucune donnée sensible, textes juridiques,
  design, migrations, CI verte avant tout déploiement).
- N'inventer ni chiffre, ni témoignage, ni soirée. Une image ou une vidéo faite par IA est signalée
  comme telle et jamais présentée comme une vraie soirée.
- Budget IA de la loop : 60 €/mois.
- Liberté totale (louis, 21/10/2026) : la loop peut tout changer sans demander, offre, prix, paiement
  et cible compris. Pas de seuil d'arrêt : une version qui rapporte moins n'est pas annulée d'office,
  la revue en juge. Un changement d'offre ou de prix se note dans `loop/DECISIONS.md` comme les autres.
- Filet (louis, 21/10/2026) : après chaque changement, vérifier que le site répond, que l'inscription, la
  candidature et le paiement d'une place marchent encore (tests et CI, puis le site en ligne). Si c'est
  cassé, annuler SON changement aussitôt, sans attendre louis, et le noter dans `loop/DECISIONS.md`
  (« arrêté », avec la cause) et dans `loop/LECONS.md`. Pas de message à louis pour ça.
- Ne jamais écrire aux restaurateurs : c'est la loop restaurateurs (cerveau), sauf le fil grand public
  pour un restaurant déjà inscrit.

## Leviers

Page d'accueil et pages publiques, textes et formats des posts Instagram / Facebook, choix des
articles du blog, liens marqués (UTM) et page d'arrivée des réseaux, mise en avant des soirées.

Méthodes à consulter (louis, 20/10/2026) : skills marketing et design dans `.claude/skills/` (textes, conversion,
SEO, réseaux, stores, événements, `frontend-design`). À utiliser si elles servent l'objectif, jamais contre les règles fixes.

## Pistes de louis (à peser, pas des ordres)

- Tunnel : les visiteurs comprennent-ils l'objectif du site ? S'inscrivent-ils ? Participent-ils ?
  S'ils ne comprennent pas, poser la question d'un pivot.
- Réseaux sociaux : jouer sur le besoin de rencontre amoureuse et de networking.
- SEO organique du site (Google, blog, balises) ; SEO de l'appli sur les stores quand elle y sera.
- Organique IA (louis, 21/10/2026) : être cité par les IA (ChatGPT, Perplexity, Google) autant que par
  Google. Robots des IA autorisés dans robots.txt ; pages « réponse » (une question, réponse dans la 1re
  phrase, FAQ) ; chaque soirée en données structurées Event, sur Facebook Événements et les agendas
  gratuits ; un Short (Remotion) par article, publié partout via Post for Me dès que la clé est là.
- Séance vidéo de louis (21/10/2026) : il donne 1 à 2 h par semaine et peut se filmer. La revue peut lui
  préparer chaque semaine 2 textes de 30 s face caméra pour les particuliers ; sous-titres et publication
  par l'IA. Juger ces vidéos contre les carrousels.
- Mesure : visites venues de chatgpt.com, perplexity.ai, gemini, copilot (Umami), et une fois par semaine
  5 questions types posées avec la recherche web pour voir si Nūr Meet sort.

Recherche web : autorisée sans demander à louis (21/10/2026), chaque fois qu'elle aide l'objectif.

## Après la revue

Ajouter à `loop/LECONS.md` une ligne par essai jugé (date, essai, chiffre, gardé ou arrêté) ou par
erreur à ne pas refaire. Garder les 40 dernières lignes.

Ajouter à `loop/DECISIONS.md` une ligne datée par décision (changé, gardé, arrêté ou question : quoi,
et pourquoi avec les chiffres), y compris quand la revue garde la méthode telle quelle. Ne jamais
effacer ce fichier : c'est l'historique des décisions, gardé pour toujours dans Notion.
