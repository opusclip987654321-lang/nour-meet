-- Publication sur la Page Facebook des articles et des soirées restaurateurs : colonnes facultatives
-- de suivi uniquement (identifiant, date, verrou d'envoi, dernière erreur).

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "facebookError" TEXT,
ADD COLUMN     "facebookPostId" TEXT,
ADD COLUMN     "facebookPublishedAt" TIMESTAMP(3),
ADD COLUMN     "facebookPublishingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "facebookError" TEXT,
ADD COLUMN     "facebookPostId" TEXT,
ADD COLUMN     "facebookPublishedAt" TIMESTAMP(3),
ADD COLUMN     "facebookPublishingAt" TIMESTAMP(3);

