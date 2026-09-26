-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountTypeChosenAt" TIMESTAMP(3);


-- Comptes existants déjà engagés (v3 §5.1) : type considéré comme définitif, pour qu'ils ne revoient
-- jamais l'écran de choix. Restent sans type seulement les comptes sans aucune activité (choix
-- interrompu), à qui le choix Participant / Restaurateur sera redemandé.
UPDATE "User" u SET "accountTypeChosenAt" = u."createdAt"
WHERE u."role" <> 'PARTICIPANT'
   OR EXISTS (SELECT 1 FROM "Organizer" r WHERE r."ownerId" = u."id")
   OR EXISTS (SELECT 1 FROM "Profile" p WHERE p."userId" = u."id" AND p."profileCompleted" = true)
   OR EXISTS (SELECT 1 FROM "Application" a WHERE a."userId" = u."id");
