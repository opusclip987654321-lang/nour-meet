-- AlterTable
ALTER TABLE "ArticleQueueEntry" ADD COLUMN     "imageUrl" TEXT;

-- DataMigration: ajoute une image d'ambiance (§2, jamais présentée comme un lieu ou une personne
-- réelle Nūr Meet) et un lien de navigation contextuel (§5, cahier des charges 2026-09 — un
-- article ne doit pas exister seulement pour le SEO, il doit renvoyer vers une partie du site,
-- ex. la page Événements filtrée sur la bonne catégorie) à chacun des 10 articles déjà rédigés,
-- qu'ils soient déjà en ligne (Article) ou encore en réserve (ArticleQueueEntry).
UPDATE "Article" SET "content" = "content" || '

Envie de vous lancer ? Consultez [nos prochaines soirées speed dating](/events?category=Speed%20dating) et réservez votre place.', "imageUrl" = '/static/defaults/speed-dating.jpg' WHERE "slug" = 'speed-dating-paris-premiere-soiree-sans-pression';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

Recréer ces occasions commence par un premier pas simple : [découvrez nos prochaines soirées speed dating](/events?category=Speed%20dating).', "imageUrl" = '/static/defaults/speed-dating.jpg' WHERE "slug" = 'rencontrer-quelquun-apres-35-ans-changer-de-methode';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

Envie d''une vraie première fois à deux ? [Découvrez nos prochains événements](/events) pour sortir de la routine ensemble.', "imageUrl" = '/static/defaults/auth-terrace.jpg' WHERE "slug" = 'raviver-complicite-couple-installe';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

Pour une première fois facile à organiser, jetez un œil à [nos prochains événements](/events) : le cadre est déjà pensé pour vous.', "imageUrl" = '/static/defaults/auth-terrace.jpg' WHERE "slug" = 'sortir-en-couple-multiplier-premieres-fois';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

Le rendez-vous concret dont cet article parle peut être [une de nos prochaines soirées](/events) — une date, une heure, une place réservée.', "imageUrl" = '/static/defaults/auth-terrace.jpg' WHERE "slug" = 'sortir-solitude-choisie-premier-pas';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

Pour commencer cette reconstruction dans un cadre bienveillant, [consultez nos prochains événements](/events).', "imageUrl" = '/static/defaults/auth-terrace.jpg' WHERE "slug" = 'vivre-seul-sans-isolement-reseau-apres-rupture';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

Pour mieux comprendre notre approche des rencontres et de la relation à deux, [découvrez le concept Nūr Meet](/concept).', "imageUrl" = '/static/defaults/speed-dating.jpg' WHERE "slug" = 'avant-le-mariage-questions-a-se-poser-a-deux';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

La meilleure façon de la pratiquer reste de la vivre : [réservez votre place à une prochaine soirée speed dating](/events?category=Speed%20dating).', "imageUrl" = '/static/defaults/networking.jpg' WHERE "slug" = 'ecoute-active-competence-sous-estimee-premier-rendez-vous';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

Ces échanges se pratiquent d''abord dans un cadre sécurisant : [consultez nos prochains événements](/events).', "imageUrl" = '/static/defaults/networking.jpg' WHERE "slug" = 'dire-non-sans-blesser-poser-ses-limites';
UPDATE "ArticleQueueEntry" SET "content" = "content" || '

D''autres réflexions comme celle-ci sont à retrouver sur [le blog Nūr Meet](/blog), et de nouvelles rencontres sur [la page Événements](/events).', "imageUrl" = '/static/defaults/speed-dating.jpg' WHERE "slug" = 'rythme-relationnel-pas-de-bon-tempo-universel';