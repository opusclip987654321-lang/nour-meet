-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "instagramInsights" JSONB,
ADD COLUMN     "instagramInsightsAt" TIMESTAMP(3),
ADD COLUMN     "instagramScore" DOUBLE PRECISION,
ADD COLUMN     "instagramVariant" JSONB;
