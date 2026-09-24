import { createHash } from "node:crypto";

// Connexion Google de l'application mobile (2026-09-24) : le retour n'est accepté que vers le schéma de
// l'application (nourmeet://) — une adresse choisie par un tiers recevrait sinon le code et la session.
// Expo Go (exp://) n'est accepté qu'hors production, pour les tests en développement.
export const isAllowedAppRedirect = (redirect: string, production: boolean) =>
  /^nourmeet:\/\/[\w./-]*$/.test(redirect) || (!production && /^exps?:\/\/[\w.:/-]+$/.test(redirect));

// PKCE (RFC 7636, méthode S256) : sur Android, n'importe quelle application peut déclarer le schéma
// nourmeet:// et intercepter le code de retour. L'application garde un secret (verifier) et n'envoie
// que son empreinte (challenge) au départ : un code intercepté est inutilisable sans ce secret.
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
// Le code de retour n'est conservé en base que sous forme d'empreinte.
export const hashHandoffCode = (code: string) => createHash("sha256").update(code).digest("hex");
