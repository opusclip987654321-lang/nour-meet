import { EVENT_CATEGORIES, EVENT_ZONES } from "@nour/shared";
import { FormEvent, ReactNode, useEffect, useState } from "react";

// Prix saisis en euros (« 35 » ou « 29,50 »), comme dans l'application mobile — stockés en centimes.
// Le texte tapé est gardé tel quel pendant la frappe (« 29, » ne doit pas redevenir « 29 »).
export function EuroInput({ cents, onChange, required }: { cents: number; onChange: (cents: number) => void; required?: boolean }) {
  const format = (c: number) => (c / 100).toFixed(2).replace(".", ",").replace(",00", "");
  const [text, setText] = useState(format(cents));
  useEffect(() => { setText(prev => { const n = Number(prev.replace(",", ".")); return Number.isFinite(n) && Math.round(n * 100) === cents ? prev : format(cents); }); }, [cents]);
  return <input required={required} inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" value={text} onChange={e => { setText(e.target.value); const n = Number(e.target.value.replace(",", ".")); if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100)); }}/>;
}

// Formulaire de soirée partagé (décision v2 §5) : création par l'administration ou un restaurateur,
// et premier événement d'un restaurateur encore en attente de validation — mêmes champs, mêmes règles,
// même charge utile envoyée à l'API (schéma unique côté serveur : services/event-drafts.ts).
export type EventFormState = { title: string; slug: string; category: string; flow: "" | "SCREENING" | "DIRECT"; description: string; startsAt: string; endsAt: string; district: string; address: string; zone: string; minAge: string; maxAge: string; capacity: number; priceCents: number; includesDrink: boolean; includesStarter: boolean; includesMain: boolean; includesDessert: boolean; perksDescription: string; minParticipants: string; minParticipantsDeadline: string };
export const emptyEventForm: EventFormState = { title: "", slug: "", category: EVENT_CATEGORIES[0].name, flow: "", description: "", startsAt: "", endsAt: "", district: "", address: "", zone: EVENT_ZONES[0], minAge: "", maxAge: "", capacity: 20, priceCents: 3000, includesDrink: false, includesStarter: false, includesMain: false, includesDessert: false, perksDescription: "", minParticipants: "", minParticipantsDeadline: "" };
const localInput = (value?: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
export const eventToForm = (ev: any): EventFormState => ({ ...emptyEventForm, title: ev.title, slug: ev.slug, category: ev.category, description: ev.description, startsAt: localInput(ev.startsAt), endsAt: localInput(ev.endsAt), district: ev.district, address: ev.address ?? "", zone: ev.zone ?? EVENT_ZONES[0], minAge: ev.minAge ? String(ev.minAge) : "", maxAge: ev.maxAge ? String(ev.maxAge) : "", capacity: ev.capacity, priceCents: ev.priceCents, includesDrink: !!ev.includesDrink, includesStarter: !!ev.includesStarter, includesMain: !!ev.includesMain, includesDessert: !!ev.includesDessert, perksDescription: ev.perksDescription ?? "", minParticipants: ev.minParticipants ? String(ev.minParticipants) : "", minParticipantsDeadline: localInput(ev.minParticipantsDeadline) });
export const eventFormPayload = (form: EventFormState) => ({ ...form, flow: form.flow || undefined, minAge: form.minAge ? Number(form.minAge) : undefined, maxAge: form.maxAge ? Number(form.maxAge) : undefined, minParticipants: form.minParticipants ? Number(form.minParticipants) : undefined, minParticipantsDeadline: form.minParticipantsDeadline ? new Date(form.minParticipantsDeadline).toISOString() : undefined, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() });
const slugify = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function EventForm({ form, setForm, showFlow = false, submitting, submitLabel, onSubmit, children }: { form: EventFormState; setForm: (f: EventFormState) => void; showFlow?: boolean; submitting: boolean; submitLabel: string; onSubmit: (e: FormEvent) => void; children?: ReactNode }) {
  return <form className="panel form-grid" onSubmit={onSubmit}>
      <label>Titre<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value,slug:form.slug?form.slug:slugify(e.target.value)})}/></label>
      <label>Identifiant (slug)<input required pattern="[a-z0-9-]+" value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label>
      <label>Catégorie<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{EVENT_CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
      {showFlow&&<label>Parcours d’inscription<select value={form.flow} onChange={e=>setForm({...form,flow:e.target.value as ""|"SCREENING"|"DIRECT"})}><option value="">Suggéré selon la catégorie</option><option value="SCREENING">Sélection (entretien requis)</option><option value="DIRECT">Accès direct (paiement immédiat)</option></select></label>}
      <label>Zone<select value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}>{EVENT_ZONES.map(z=><option key={z} value={z}>{z}</option>)}</select></label>
      <div className="time-row"><label>Âge minimum (facultatif)<input type="number" min={18} max={99} value={form.minAge} onChange={e=>setForm({...form,minAge:e.target.value})}/></label><label>Âge maximum (facultatif)<input type="number" min={18} max={99} value={form.maxAge} onChange={e=>setForm({...form,maxAge:e.target.value})}/></label></div>
      <label className="wide">Description<textarea required minLength={20} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <div className="time-row"><label>Début<input required type="datetime-local" value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label><label>Fin<input required type="datetime-local" value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label></div>
      <label>Quartier / ville<input required value={form.district} onChange={e=>setForm({...form,district:e.target.value})}/></label>
      <label>Adresse<input required value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
      <div className="time-row"><label>Capacité totale<input required type="number" min={5} max={500} value={form.capacity} onChange={e=>setForm({...form,capacity:Number(e.target.value)})}/></label><label>Prix (€, TTC)<EuroInput required cents={form.priceCents} onChange={c=>setForm({...form,priceCents:c})}/></label></div>
      <div className="wide"><small>Prestations réellement incluses</small><div className="perks-checks">
        <label><input type="checkbox" checked={form.includesDrink} onChange={e=>setForm({...form,includesDrink:e.target.checked})}/> Boisson</label>
        <label><input type="checkbox" checked={form.includesStarter} onChange={e=>setForm({...form,includesStarter:e.target.checked})}/> Entrée</label>
        <label><input type="checkbox" checked={form.includesMain} onChange={e=>setForm({...form,includesMain:e.target.checked})}/> Plat</label>
        <label><input type="checkbox" checked={form.includesDessert} onChange={e=>setForm({...form,includesDessert:e.target.checked})}/> Dessert</label>
      </div></div>
      <label className="wide">Précisions sur les prestations<textarea value={form.perksDescription} onChange={e=>setForm({...form,perksDescription:e.target.value})} placeholder="Ex. : cocktail sans alcool à l’arrivée, buffet salé…"/></label>
      <div className="time-row"><label>Minimum de participants (facultatif)<input type="number" min={1} value={form.minParticipants} onChange={e=>setForm({...form,minParticipants:e.target.value})}/></label>{form.minParticipants&&<label>Date limite de décision<input required type="datetime-local" value={form.minParticipantsDeadline} onChange={e=>setForm({...form,minParticipantsDeadline:e.target.value})}/></label>}</div>
      {children??<p className="fine wide">Les quotas hommes/femmes (Speed dating), les tarifs différenciés et la galerie photo se règlent après création, depuis « Mes événements ».</p>}
      <button className="button" disabled={submitting}>{submitting?"Enregistrement…":submitLabel}</button>
    </form>;
}
