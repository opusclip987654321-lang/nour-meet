-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "annualPriceCents" INTEGER,
ADD COLUMN     "highlightTier" TEXT,
ADD COLUMN     "stripePriceAnnualId" TEXT,
ADD COLUMN     "stripePriceMonthlyId" TEXT;

-- AlterTable
ALTER TABLE "RestaurantSubscription" ADD COLUMN     "billingPeriod" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeCustomerId" TEXT;

