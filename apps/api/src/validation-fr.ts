import { ZodError, ZodIssueCode, z } from "zod";

// Messages de validation en français (corrections web 2026-09-24, §18) : ce sont eux qu'affichent les
// formulaires du site quand l'API refuse une saisie, jamais les messages anglais par défaut de Zod.
// Un message déjà écrit dans un schéma (ex. « Le SIRET doit comporter 14 chiffres ») reste prioritaire.
const FIELD_LABELS: Record<string, string> = {
  displayName: "Prénom ou pseudonyme", email: "E-mail", birthDate: "Date de naissance", city: "Ville", phone: "Téléphone",
  name: "Nom", managerName: "Nom du responsable", siret: "SIRET", title: "Titre", slug: "Identifiant", description: "Description",
  startsAt: "Date de début", endsAt: "Date de fin", capacity: "Capacité", priceCents: "Prix", motivation: "Motivation", code: "Code",
  reason: "Motif", content: "Contenu", category: "Thème", text: "Texte", body: "Message"
};

z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" || issue.received === "null" ? "Champ obligatoire" : "Valeur invalide" };
    case ZodIssueCode.too_small:
      return { message: issue.type === "string" ? (Number(issue.minimum) <= 1 ? "Champ obligatoire" : `${issue.minimum} caractères minimum`) : issue.type === "array" ? `${issue.minimum} élément(s) minimum` : `Valeur minimale : ${issue.minimum}` };
    case ZodIssueCode.too_big:
      return { message: issue.type === "string" ? `${issue.maximum} caractères maximum` : issue.type === "array" ? `${issue.maximum} élément(s) maximum` : `Valeur maximale : ${issue.maximum}` };
    case ZodIssueCode.invalid_string:
      return { message: issue.validation === "email" ? "Adresse e-mail invalide" : "Format invalide" };
    case ZodIssueCode.invalid_enum_value:
      return { message: "Choix invalide" };
    default:
      return { message: ctx.defaultError };
  }
});

export const describeZodError = (error: ZodError) => {
  const issue = error.issues[0];
  if (!issue) return "Données invalides";
  const field = issue.path.map(String).reverse().find(p => FIELD_LABELS[p]);
  return field ? `${FIELD_LABELS[field]} : ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}` : `Données invalides : ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`;
};
