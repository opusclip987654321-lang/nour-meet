-- Essai gratuit sans carte bancaire (décision du 2026-11-10) : distingue un essai offert, qui
-- s'arrête à son échéance, des anciens essais attribués à la main, qui devenaient payants.
ALTER TABLE "RestaurantSubscription" ADD COLUMN "freeTrial" BOOLEAN NOT NULL DEFAULT false;
