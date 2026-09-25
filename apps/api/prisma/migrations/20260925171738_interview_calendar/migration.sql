-- Calendrier des entretiens ouvert par défaut (v2 §11) : ajout des plages bloquées uniquement.
-- Aucune ligne ScreeningCall n'est modifiée ni supprimée : les rendez-vous déjà réservés restent
-- la source de vérité des horaires occupés.

-- CreateTable
CREATE TABLE "InterviewBlock" (
    "id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewBlock_startsAt_endsAt_idx" ON "InterviewBlock"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ScreeningCall_startsAt_idx" ON "ScreeningCall"("startsAt");

