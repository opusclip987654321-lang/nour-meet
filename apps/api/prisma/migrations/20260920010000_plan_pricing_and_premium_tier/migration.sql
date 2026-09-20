-- AlterTable
ALTER TABLE "Plan" ALTER COLUMN "monthlyEventQuota" DROP NOT NULL;

-- DataMigration: prix et quotas définitifs arbitrés par l'utilisateur le 2026-09-20 (cahier des
-- charges 2026-09, §7 — remplace les valeurs provisoires de la migration
-- 20260919160000_restaurant_subscriptions_and_min_participants) : Standard 60€/mois pour 3 soirées
-- PUBLIÉES par mois, Premium 100€/mois illimité (NULL = illimité). N'affecte aucun abonnement déjà
-- souscrit : seuls le prix/quota de la formule elle-même changent, un abonnement en cours ne change
-- de conditions qu'à son prochain renouvellement (relit toujours Plan par sa relation, jamais copié).
UPDATE "Plan" SET "monthlyPriceCents" = 6000, "monthlyEventQuota" = 3 WHERE "id" = 'plan_standard_v1';

INSERT INTO "Plan" ("id", "name", "monthlyPriceCents", "monthlyEventQuota", "active", "createdAt")
VALUES ('plan_premium_v1', 'Premium', 10000, NULL, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

