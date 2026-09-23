-- DataMigration: tarifs définitifs (instructions 2026-09-20) — Standard 69€/mois, 690€/an,
-- 3 événements publiés/mois, mise en avant simple ; Premium 89€/mois, 890€/an, illimité, mise
-- en avant prioritaire. Price IDs Stripe TEST créés au moment de cette migration (voir script
-- _tmp-stripe-setup.ts, exécuté une fois) — ne peuvent pas être reproduits par un simple SQL
-- replay dans un autre environnement Stripe : à recréer via le même script si besoin.
UPDATE "Plan" SET "monthlyPriceCents"=6900,"annualPriceCents"=69000,"monthlyEventQuota"=3,"highlightTier"='simple',"stripePriceMonthlyId"='price_1UHoXdV05CDDuliQpJo3rrPb',"stripePriceAnnualId"='price_1UHoXeV05CDDuliQAUcw9ybx' WHERE "id"='plan_standard_v1';
UPDATE "Plan" SET "monthlyPriceCents"=8900,"annualPriceCents"=89000,"monthlyEventQuota"=NULL,"highlightTier"='priority',"stripePriceMonthlyId"='price_1UHoXeV05CDDuliQkcepbMzE',"stripePriceAnnualId"='price_1UHoXfV05CDDuliQsW5sxCty' WHERE "id"='plan_premium_v1';