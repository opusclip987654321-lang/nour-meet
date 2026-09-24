import { PrismaClient, UserRole } from "@prisma/client";

// Nomme un super-administrateur (rôle ADMIN) à partir de l'e-mail de connexion (Google ou code par
// e-mail) : aucune route de l'API ne permet de se donner ce rôle, il ne s'attribue qu'ici, par une
// personne qui a déjà accès au serveur. Le compte doit exister (s'être connecté une fois).
// Usage (sur le serveur) : docker exec -w /app/apps/api nour-v2-api-1 npx tsx prisma/grant-admin.ts vous@exemple.fr
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage : npx tsx prisma/grant-admin.ts adresse@e-mail [--force]");
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, deletedAt: null } });
  // Seule une adresse vérifiée (code reçu ou Google) identifie la personne : une adresse simplement
  // saisie dans un profil ne prouve rien.
  if (user && !user.emailVerifiedAt) {
    console.error(`L’adresse ${email} n’a jamais été vérifiée sur ce compte. Connectez-vous d’abord avec Google ou un code reçu par e-mail.`);
    process.exit(1);
  }
  if (!user) {
    console.error(`Aucun compte actif avec l’e-mail ${email}. Connectez-vous d’abord une fois sur le site avec cette adresse.`);
    process.exit(1);
  }
  if (user.role === UserRole.ADMIN) { console.log(`${email} est déjà super-administrateur.`); process.exit(0); }
  // Un compte restaurateur ou d'accueil a un périmètre restreint : on ne l'élève pas sans le confirmer.
  if (user.role !== UserRole.PARTICIPANT && !process.argv.includes("--force")) {
    console.error(`Ce compte a le rôle ${user.role}. Relancez avec --force pour le nommer super-administrateur quand même.`);
    process.exit(1);
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { role: UserRole.ADMIN } }),
    prisma.auditLog.create({ data: { actorId: user.id, action: "GRANT_ADMIN_CLI", entity: "User", entityId: user.id, metadata: { previousRole: user.role } } })
  ]);
  console.log(`${email} (${user.displayName}) est maintenant super-administrateur. Rechargez le site pour voir l’administration.`);
} finally {
  await prisma.$disconnect();
}
