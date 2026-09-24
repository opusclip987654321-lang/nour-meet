-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "imageAiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagramCaption" TEXT,
ADD COLUMN     "instagramError" TEXT,
ADD COLUMN     "instagramMediaId" TEXT,
ADD COLUMN     "instagramPublishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SocialCredential" (
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialCredential_pkey" PRIMARY KEY ("provider")
);

