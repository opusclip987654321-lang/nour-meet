-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "autoPublishDay" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organizer" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RestaurantSubscription" ADD COLUMN     "pendingChangeAt" TIMESTAMP(3),
ADD COLUMN     "pendingPlanId" TEXT,
ADD COLUMN     "stripeScheduleId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Article_autoPublishDay_key" ON "Article"("autoPublishDay");

