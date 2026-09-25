-- AlterTable
ALTER TABLE "Profile" ALTER COLUMN "shareCode" SET DEFAULT ('NOUR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)));


-- Les codes personnels déjà attribués sous forme d'identifiant technique (cuid, 25 caractères)
-- deviennent lisibles ; les codes déjà lisibles (ex. NOUR-SOFIA-8421) ne changent pas. 48 bits
-- aléatoires par code : collision entre codes existants négligeable (≈ N² / 2^49).
UPDATE "Profile" SET "shareCode" = DEFAULT WHERE "shareCode" ~ '^c[a-z0-9]{24}$';
