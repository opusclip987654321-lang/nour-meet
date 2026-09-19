-- CreateEnum
CREATE TYPE "EventFlow" AS ENUM ('SCREENING', 'DIRECT');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "flow" "EventFlow" NOT NULL DEFAULT 'DIRECT';

-- DataMigration: préserve le comportement existant des événements déjà créés sous la catégorie
-- "Speed dating" (seule catégorie exigeant une sélection avant ce changement) en les marquant
-- explicitement SCREENING ; toute autre catégorie existante reste DIRECT, sans perte de données.
UPDATE "Event" SET "flow" = 'SCREENING' WHERE "category" = 'Speed dating';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundExceptionReason" TEXT,
ADD COLUMN     "refundedAmountCents" INTEGER;

-- CreateTable
CREATE TABLE "ScreeningAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "motivation" TEXT NOT NULL,
    "relationshipGoal" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "desiredQualities" TEXT NOT NULL,
    "ageRangeSought" TEXT NOT NULL,
    "valuesAndLifestyle" TEXT NOT NULL,
    "noteForOrganizer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkingAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "currentRole" TEXT NOT NULL,
    "experienceLevel" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "soughtProfiles" TEXT NOT NULL,
    "contribution" TEXT NOT NULL,
    "topics" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkingAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningAnswer_applicationId_key" ON "ScreeningAnswer"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkingAnswer_applicationId_key" ON "NetworkingAnswer"("applicationId");

-- AddForeignKey
ALTER TABLE "ScreeningAnswer" ADD CONSTRAINT "ScreeningAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkingAnswer" ADD CONSTRAINT "NetworkingAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
