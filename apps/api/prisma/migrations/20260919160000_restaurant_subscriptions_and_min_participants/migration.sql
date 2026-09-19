-- CreateEnum
CREATE TYPE "MinParticipantsOutcome" AS ENUM ('MAINTAINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "ConnectedAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "minParticipants" INTEGER,
ADD COLUMN     "minParticipantsDeadline" TIMESTAMP(3),
ADD COLUMN     "minParticipantsDecidedAt" TIMESTAMP(3),
ADD COLUMN     "minParticipantsDecidedBy" TEXT,
ADD COLUMN     "minParticipantsNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "minParticipantsOutcome" "MinParticipantsOutcome",
ADD COLUMN     "quotaConsumedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organizer" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "allowsPrivatization" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "averagePricePerPersonCents" INTEGER,
ADD COLUMN     "defaultMinParticipants" INTEGER,
ADD COLUMN     "desiredCapacity" INTEGER,
ADD COLUMN     "desiredSchedule" TEXT,
ADD COLUMN     "priceIncludesDessert" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceIncludesDrink" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceIncludesMain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceIncludesStarter" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceNotes" TEXT,
ADD COLUMN     "proposesCategoryPricing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialConditions" TEXT;

-- CreateTable
CREATE TABLE "RestaurantPhoto" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "monthlyEventQuota" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantSubscription" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantMonthlyUsage" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "eventsPublished" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RestaurantMonthlyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "externalAccountId" TEXT NOT NULL,
    "status" "ConnectedAccountStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantSubscription_restaurantId_key" ON "RestaurantSubscription"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantMonthlyUsage_restaurantId_yearMonth_key" ON "RestaurantMonthlyUsage"("restaurantId", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_restaurantId_key" ON "ConnectedAccount"("restaurantId");

-- AddForeignKey
ALTER TABLE "RestaurantPhoto" ADD CONSTRAINT "RestaurantPhoto_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantSubscription" ADD CONSTRAINT "RestaurantSubscription_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantSubscription" ADD CONSTRAINT "RestaurantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantMonthlyUsage" ADD CONSTRAINT "RestaurantMonthlyUsage_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: plan par défaut remplaçant la commission 30/70 (§8.2 du cahier des charges v3),
-- 100€/mois et 2 événements publiables par mois — valeurs provisoires documentées dans
-- apps/api/src/settings.ts, modifiables ensuite sans nouvelle migration.
INSERT INTO "Plan" ("id", "name", "monthlyPriceCents", "monthlyEventQuota", "active", "createdAt")
VALUES ('plan_standard_v1', 'Standard', 10000, 2, true, CURRENT_TIMESTAMP);

