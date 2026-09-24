import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "./demo-data.js";

// Seul script de données autorisé en production (corrections web 2026-09-24, §8) : n'ajoute que les
// restaurants et soirées de démonstration marqués isDemo=true, jamais de compte de test ni de
// donnée utilisateur. Idempotent. Usage : npm run prisma:seed:demo -w @nour/api
const prisma = new PrismaClient();
seedDemoData(prisma)
  .then(result => console.log(`Données de démonstration à jour : ${result.restaurants} restaurants, ${result.events} événements (isDemo=true).`))
  .finally(() => prisma.$disconnect());
