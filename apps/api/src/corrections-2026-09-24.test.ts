import { EVENT_VIEWER_STATUS_LABEL, eventViewerStatus, upcomingEventsInOrder } from "@nour/shared";
import { describe, expect, it } from "vitest";
import { subscriptionChangeTiming } from "@nour/shared";
import { NOT_BOOKABLE_MESSAGE, isEventBookable } from "./domain.js";
import { parisDay, sanitizeGeneratedArticle, sanitizeInstagramCaption } from "./services/blog-content.js";

// Règles critiques des corrections web du 2026-09-24 testables sans base ni serveur.

describe("catalogue participant : événements futurs, du plus proche au plus éloigné (§5.1)", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  it("écarte les événements passés et trie sur la vraie date, jamais sur une chaîne", () => {
    const events = [
      { id: "octobre", startsAt: "2026-10-02T19:00:00Z" },
      { id: "passe", startsAt: "2026-09-20T19:00:00Z" },
      { id: "septembre", startsAt: "2026-09-26T19:00:00Z" },
      // « 10/10 » passerait avant « 26/09 » dans un tri de chaînes au format jour/mois.
      { id: "dix-octobre", startsAt: new Date("2026-10-10T17:00:00Z") }
    ];
    expect(upcomingEventsInOrder(events, now).map(e => e.id)).toEqual(["septembre", "octobre", "dix-octobre"]);
  });
});

describe("statut du visiteur sur une carte d'événement (§5.2)", () => {
  it("« Participe déjà » pour une place confirmée non annulée", () => {
    expect(eventViewerStatus({ reservation: { confirmedAt: new Date(), cancelledAt: null } })).toBe("CONFIRMED");
    expect(EVENT_VIEWER_STATUS_LABEL.CONFIRMED).toBe("Participe déjà");
  });
  it("« Liste d’attente » pour une inscription en liste d'attente sans place confirmée", () => {
    expect(eventViewerStatus({ reservation: null, onWaitlist: true })).toBe("WAITLIST");
    expect(EVENT_VIEWER_STATUS_LABEL.WAITLIST).toBe("Liste d’attente");
  });
  it("rien pour tous les autres cas (réservation annulée, verrou de paiement en cours, aucun lien)", () => {
    expect(eventViewerStatus({ reservation: { confirmedAt: new Date(), cancelledAt: new Date() } })).toBeNull();
    expect(eventViewerStatus({ reservation: { confirmedAt: null, cancelledAt: null } })).toBeNull();
    expect(eventViewerStatus({})).toBeNull();
  });
});

describe("événement de démonstration jamais réservable (§8)", () => {
  it("isEventBookable refuse un événement isDemo et accepte les autres", () => {
    expect(isEventBookable({ isDemo: true })).toBe(false);
    expect(isEventBookable({ isDemo: false })).toBe(true);
    expect(NOT_BOOKABLE_MESSAGE).toMatch(/pas réservable/);
    expect(NOT_BOOKABLE_MESSAGE).not.toMatch(/d[ée]mo|test/i);
  });
});

describe("changement de formule ou de périodicité restaurateur (§1.4, décision du 2026-09-25)", () => {
  const standard = 6900, premium = 8900;
  const at = (monthlyPriceCents: number, billingPeriod: "MONTHLY" | "ANNUAL") => ({ monthlyPriceCents, billingPeriod });
  it("formule supérieure ou passage à l'annuel : immédiat", () => {
    expect(subscriptionChangeTiming(at(standard, "MONTHLY"), at(premium, "MONTHLY"))).toBe("IMMEDIATE");
    expect(subscriptionChangeTiming(at(premium, "MONTHLY"), at(premium, "ANNUAL"))).toBe("IMMEDIATE");
    expect(subscriptionChangeTiming(at(standard, "MONTHLY"), at(premium, "ANNUAL"))).toBe("IMMEDIATE");
  });
  it("formule inférieure ou passage au mensuel : à la fin de la période payée", () => {
    expect(subscriptionChangeTiming(at(premium, "MONTHLY"), at(standard, "MONTHLY"))).toBe("AT_PERIOD_END");
    expect(subscriptionChangeTiming(at(premium, "ANNUAL"), at(premium, "MONTHLY"))).toBe("AT_PERIOD_END");
    // Même vers une formule plus chère : quitter l'annuel n'écourte jamais l'année payée.
    expect(subscriptionChangeTiming(at(standard, "ANNUAL"), at(premium, "MONTHLY"))).toBe("AT_PERIOD_END");
  });
});

describe("article généré : seules les sources réellement trouvées sont publiées (§3.4)", () => {
  const body = (extra: string) => [
    "## Pourquoi c'est difficile", `${"Un texte de fond sur la solitude en ville, avec des exemples concrets et des conseils pratiques. ".repeat(40)}`,
    extra,
    "![Une terrasse animée](photo:paris-terrace)", "![Image inventée](photo:inexistante)",
    "```chart\n" + JSON.stringify({ title: "Part des personnes seules", unit: "%", sourceLabel: "INSEE", sourceUrl: "https://www.insee.fr/fr/statistiques/1", data: [{ label: "2010", value: 10 }, { label: "2020", value: 12 }] }) + "\n```",
    "```chart\n" + JSON.stringify({ title: "Chiffre inventé", sourceLabel: "Blog", sourceUrl: "https://inconnu.example/x", data: [{ label: "a", value: 1 }, { label: "b", value: 2 }] }) + "\n```",
    "[[cta:/events|Voir les soirées]]", "[[cta:/admin|Espace admin]]"
  ].join("\n\n");
  const base = { kind: "factual" as const, title: "La solitude en ville", excerpt: "Chapô.", category: "Solitude et vie sociale", keywords: ["Solitude"], metaTitle: "Solitude", metaDescription: "Description", coverPhoto: "friends-duo", imagePrompt: "A warm Parisian café terrace", instagramCaption: "Accroche.\n\nArticle complet : lien en bio\n#rencontres", sources: [] as { title: string; url: string }[] };

  it("retire les liens et graphiques non vérifiés, les images et appels à l'action invalides, et ajoute les sources", () => {
    const clean = sanitizeGeneratedArticle({ ...base, content: body("Selon [l'INSEE](https://www.insee.fr/fr/statistiques/1) et [une étude inventée](https://fausse.example/etude), voir [nos soirées](/events) ou [l'admin](/admin)."), sources: [{ title: "INSEE", url: "https://www.insee.fr/fr/statistiques/1" }, { title: "Inventée", url: "https://fausse.example/etude" }] }, ["https://www.insee.fr/fr/statistiques/1/"]);
    expect(clean.content).toContain("[l'INSEE](https://www.insee.fr/fr/statistiques/1)");
    expect(clean.content).not.toContain("fausse.example");
    expect(clean.content).toContain("une étude inventée");
    expect(clean.content).toContain("[nos soirées](/events)");
    expect(clean.content).not.toContain("(/admin)");
    expect(clean.content).toContain("photo:paris-terrace");
    expect(clean.content).not.toContain("photo:inexistante");
    expect(clean.content).toContain("Part des personnes seules");
    expect(clean.content).not.toContain("Chiffre inventé");
    expect(clean.content).toContain("[[cta:/events|Voir les soirées]]");
    expect(clean.content).not.toContain("cta:/admin");
    expect(clean.content).toMatch(/## Sources\n\n- \[INSEE\]\(https:\/\/www\.insee\.fr\/fr\/statistiques\/1\)$/);
    expect(clean.imageUrl).toBe("photo:friends-duo");
  });

  it("refuse un article factuel sans aucune source vérifiée, et le mot interdit par la charte", () => {
    expect(() => sanitizeGeneratedArticle({ ...base, content: body("Selon [une étude](https://fausse.example/x).") }, [])).toThrow(/source/);
    expect(() => sanitizeGeneratedArticle({ ...base, kind: "editorial", title: "Rencontres musulmanes", content: body("") }, [])).toThrow(/interdit/);
  });

  it("accepte un article éditorial sans source", () => {
    expect(sanitizeGeneratedArticle({ ...base, kind: "editorial", content: body("") }, []).sourcesCount).toBe(0);
  });

  it("calcule le jour de publication dans le fuseau de Paris", () => {
    expect(parisDay(new Date("2026-09-24T22:30:00Z"))).toBe("2026-09-25");
    expect(parisDay(new Date("2026-09-24T21:30:00Z"))).toBe("2026-09-24");
  });
});

describe("légende Instagram de l'article du jour", () => {
  it("retire les URL, respecte la limite d'Instagram et refuse le mot interdit par la charte", () => {
    const caption = sanitizeInstagramCaption(`Première ligne.\nVoir https://exemple.com/article et www.site.fr\n${"#tag ".repeat(600)}`);
    expect(caption).not.toMatch(/https?:|www\./);
    expect(caption!.length).toBeLessThanOrEqual(2200);
    expect(sanitizeInstagramCaption("Rencontres musulmanes à Paris")).toBeNull();
    expect(sanitizeInstagramCaption("   ")).toBeNull();
  });
});

describe("retour de la connexion Google vers l'application mobile", () => {
  it("n'accepte que le schéma de l'application en production, et Expo Go seulement en développement", async () => {
    const { isAllowedAppRedirect } = await import("./services/app-redirect.js");
    expect(isAllowedAppRedirect("nourmeet://auth", true)).toBe(true);
    expect(isAllowedAppRedirect("exp://192.168.1.10:8081/--/auth", true)).toBe(false);
    expect(isAllowedAppRedirect("exp://192.168.1.10:8081/--/auth", false)).toBe(true);
    expect(isAllowedAppRedirect("https://pirate.example/vol", false)).toBe(false);
    expect(isAllowedAppRedirect("nourmeet://auth?next=https://pirate.example", true)).toBe(false);
  });
  it("vérifie le secret PKCE (S256, empreinte calculée indépendamment)", async () => {
    const { pkceChallenge, PKCE_CHALLENGE, PKCE_VERIFIER } = await import("./services/app-redirect.js");
    const verifier = "a".repeat(43);
    expect(pkceChallenge(verifier)).toBe("ZtNPunH49FD35FWYhT5Tv8I7vRKQJ8uxMaL0_9eHjNA");
    expect(PKCE_VERIFIER.test(verifier)).toBe(true);
    expect(PKCE_CHALLENGE.test(pkceChallenge(verifier))).toBe(true);
  });
});
