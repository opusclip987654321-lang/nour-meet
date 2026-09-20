-- CreateTable
CREATE TABLE "ArticleQueueEntry" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keywords" TEXT[],
    "metaTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleQueueState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastReleasedAt" TIMESTAMP(3),

    CONSTRAINT "ArticleQueueState_pkey" PRIMARY KEY ("id")
);

-- DataMigration: garde un seul des 10 articles du 2026-09-20 déjà en ligne (Article, statut
-- DRAFT, visible immédiatement dans l'espace admin) et renvoie les 9 autres dans la réserve
-- ArticleQueueEntry, pour qu'ils ne sortent qu'un par jour via releaseQueuedArticle() une fois
-- en production, plutôt que d'apparaître tous en même temps (cahier des charges 2026-09, §5).
-- lastReleasedAt est initialisé à aujourd'hui pour ne pas déclencher une seconde sortie le jour
-- même où cette migration s'applique.
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 1, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'raviver-complicite-couple-installe';
DELETE FROM "Article" WHERE "slug" = 'raviver-complicite-couple-installe';
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 2, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'sortir-solitude-choisie-premier-pas';
DELETE FROM "Article" WHERE "slug" = 'sortir-solitude-choisie-premier-pas';
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 3, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'avant-le-mariage-questions-a-se-poser-a-deux';
DELETE FROM "Article" WHERE "slug" = 'avant-le-mariage-questions-a-se-poser-a-deux';
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 4, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'ecoute-active-competence-sous-estimee-premier-rendez-vous';
DELETE FROM "Article" WHERE "slug" = 'ecoute-active-competence-sous-estimee-premier-rendez-vous';
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 5, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'rythme-relationnel-pas-de-bon-tempo-universel';
DELETE FROM "Article" WHERE "slug" = 'rythme-relationnel-pas-de-bon-tempo-universel';
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 6, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'rencontrer-quelquun-apres-35-ans-changer-de-methode';
DELETE FROM "Article" WHERE "slug" = 'rencontrer-quelquun-apres-35-ans-changer-de-methode';
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 7, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'sortir-en-couple-multiplier-premieres-fois';
DELETE FROM "Article" WHERE "slug" = 'sortir-en-couple-multiplier-premieres-fois';
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 8, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'vivre-seul-sans-isolement-reseau-apres-rupture';
DELETE FROM "Article" WHERE "slug" = 'vivre-seul-sans-isolement-reseau-apres-rupture';
INSERT INTO "ArticleQueueEntry" ("id","position","title","slug","excerpt","content","category","keywords","metaTitle","metaDescription","createdAt") SELECT gen_random_uuid()::text, 9, "title", "slug", COALESCE("excerpt",''), "content", "category", "keywords", COALESCE("metaTitle",''), COALESCE("metaDescription",''), CURRENT_TIMESTAMP FROM "Article" WHERE "slug" = 'dire-non-sans-blesser-poser-ses-limites';
DELETE FROM "Article" WHERE "slug" = 'dire-non-sans-blesser-poser-ses-limites';
INSERT INTO "ArticleQueueState" ("id","lastReleasedAt") VALUES ('singleton', CURRENT_TIMESTAMP) ON CONFLICT ("id") DO UPDATE SET "lastReleasedAt" = CURRENT_TIMESTAMP;