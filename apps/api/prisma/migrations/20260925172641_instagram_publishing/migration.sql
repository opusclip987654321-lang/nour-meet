-- Publication Instagram : verrou d'envoi des carrousels d'articles (v2 §6) et suivi de la
-- publication des événements restaurateurs (v2 §14). Colonnes facultatives uniquement.

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "instagramPublishingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "instagramError" TEXT,
ADD COLUMN     "instagramMediaId" TEXT,
ADD COLUMN     "instagramPublishedAt" TIMESTAMP(3),
ADD COLUMN     "instagramPublishingAt" TIMESTAMP(3);

