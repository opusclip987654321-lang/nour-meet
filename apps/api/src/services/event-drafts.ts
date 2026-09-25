import { EVENT_CATEGORY_NAMES, EVENT_ZONES, suggestedFlowForCategory } from "@nour/shared";
import { EventStatus } from "@prisma/client";
import { z } from "zod";

// Schéma et construction d'une soirée, partagés par la création classique (POST /admin/events) et
// le premier brouillon d'un restaurateur encore en attente de validation (décision v2 §5) : une
// seule définition des champs et des règles, jamais deux validations qui divergent.
export const perksInput = { includesDrink: z.boolean().default(false), includesStarter: z.boolean().default(false), includesMain: z.boolean().default(false), includesDessert: z.boolean().default(false), perksDescription: z.string().max(500).optional() };
export const eventCreateSchema = z.object({ venueRestaurantId: z.string().optional(), title: z.string().trim().min(3).max(150), slug: z.string().max(160).regex(/^[a-z0-9-]+$/), category: z.enum(EVENT_CATEGORY_NAMES as [string, ...string[]]), flow: z.enum(["SCREENING", "DIRECT"]).optional(), description: z.string().min(20).max(5000), startsAt: z.string(), endsAt: z.string(), district: z.string().trim().min(2).max(200), address: z.string().trim().min(2).max(200), zone: z.enum(EVENT_ZONES as [string, ...string[]]), minAge: z.number().int().min(18).max(99).optional(), maxAge: z.number().int().min(18).max(99).optional(), capacity: z.number().int().min(5).max(500), priceCents: z.number().int().min(0), publish: z.boolean().default(false), minParticipants: z.number().int().min(1).optional(), minParticipantsDeadline: z.string().optional(), ...perksInput })
    // Minimum facultatif, mais la date limite devient obligatoire dès qu'un minimum est défini (§10).
    .refine(v => !v.minParticipants || v.minParticipantsDeadline, { message: "Une date limite de décision est obligatoire dès qu'un minimum de participants est défini", path: ["minParticipantsDeadline"] })
    // Dates lisibles et dans l'ordre : une date invalide est une erreur de saisie (400), jamais une 500.
    .refine(v => !Number.isNaN(Date.parse(v.startsAt)) && !Number.isNaN(Date.parse(v.endsAt)), { message: "Date de début ou de fin invalide", path: ["startsAt"] })
    .refine(v => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: "La fin doit être après le début", path: ["endsAt"] })
    .refine(v => !v.minParticipantsDeadline || !Number.isNaN(Date.parse(v.minParticipantsDeadline)), { message: "Date limite invalide", path: ["minParticipantsDeadline"] })
    .refine(v => v.minAge == null || v.maxAge == null || v.minAge <= v.maxAge, { message: "L’âge minimum doit être inférieur ou égal à l’âge maximum", path: ["maxAge"] });
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

export const eventCreateData = (input: EventCreateInput, opts: { controllerRestaurantId: string | null; venueRestaurantId: string | null; flow?: "SCREENING" | "DIRECT"; status: EventStatus }) => ({
  title: input.title, slug: input.slug, category: input.category, flow: opts.flow ?? suggestedFlowForCategory(input.category), description: input.description,
  startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), district: input.district, address: input.address, zone: input.zone,
  capacity: input.capacity, priceCents: input.priceCents,
  includesDrink: input.includesDrink, includesStarter: input.includesStarter, includesMain: input.includesMain, includesDessert: input.includesDessert, perksDescription: input.perksDescription,
  controllerRestaurantId: opts.controllerRestaurantId, venueRestaurantId: opts.venueRestaurantId,
  minParticipants: input.minParticipants, minParticipantsDeadline: input.minParticipantsDeadline ? new Date(input.minParticipantsDeadline) : undefined,
  minAge: input.minAge, maxAge: input.maxAge,
  status: opts.status
});
