import * as Sentry from "@sentry/node";
import { env } from "./env.js";

// Surveillance d'erreurs (préparation mise en production, 2026-09) : totalement inactive tant
// qu'aucun SENTRY_DSN n'est fourni — jamais un identifiant tiers qui traînerait par défaut.
// Formule gratuite visée explicitement : aucun taux d'échantillonnage de performance ni de
// replay de session (ces fonctionnalités consomment le quota gratuit très vite et le replay
// pourrait capturer des éléments d'écran sensibles) — uniquement la capture d'erreurs.
export const initSentry = () => {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
    // Ne jamais transmettre le corps de la requête/réponse (peut contenir mot de passe, jeton,
    // moyen de paiement, réponses de questionnaire) ni les en-têtes d'authentification : seule la
    // trace d'erreur et l'URL (sans paramètres) partent vers Sentry.
    beforeSend(event) {
      return scrubSensitiveData(event);
    }
  });
};

const SENSITIVE_KEYS = /token|password|secret|authorization|jwt|card|cvc|iban|otp|code/i;

function scrubSensitiveData<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_KEYS.test(key)) delete event.request.headers[key];
      }
    }
    if (event.request.query_string) event.request.query_string = undefined;
  }
  // Jamais d'identité précise (nom, téléphone, e-mail) associée à l'événement d'erreur : seul un
  // id technique anonyme, s'il existe déjà, peut aider à recouper plusieurs erreurs du même compte.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  return event;
}

export { Sentry };
