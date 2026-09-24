// Surveillance d'erreurs (préparation mise en production, 2026-09) : totalement inactive tant
// qu'aucun VITE_SENTRY_DSN n'est fourni au build. Formule gratuite visée explicitement : pas de
// replay de session (capturerait l'écran d'un participant, potentiellement des réponses de
// questionnaire ou un numéro de carte affiché un instant) et pas de suivi de performance.
// Le SDK (≈ 60 ko) n'est téléchargé que si un DSN est configuré, jamais dans le lot initial
// (corrections web 2026-09-24, §11). Un échec de chargement n'empêche jamais le site de fonctionner.
export async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [],
    tracesSampleRate: 0,
    beforeSend(event) {
      // Jamais le jeton de session (localStorage nour_token) ni un corps de requête/réponse : ne
      // laisser passer que le message d'erreur et la pile d'appel, jamais de contexte applicatif.
      delete event.request?.cookies;
      delete event.request?.headers;
      if (event.user) event.user = undefined;
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = exception.value.replace(/nour_token=[^&\s]+/gi, "nour_token=[retiré]");
      }
      return event;
    }
  });
}
