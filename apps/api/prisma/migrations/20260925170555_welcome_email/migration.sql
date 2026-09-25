-- AlterTable
ALTER TABLE "User" ADD COLUMN     "welcomeEmailSentAt" TIMESTAMP(3);


-- Comptes existants : ils sont déjà inscrits, aucun e-mail de bienvenue tardif ne doit leur partir.
UPDATE "User" SET "welcomeEmailSentAt" = "createdAt" WHERE "emailVerifiedAt" IS NOT NULL;
