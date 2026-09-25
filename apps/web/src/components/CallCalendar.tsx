import { addDays, parisDayKey } from "@nour/shared";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

// Calendrier des entretiens (décision v2 §11) : ouvert par défaut tous les jours de 10h à 22h, par
// quarts d'heure. On navigue semaine par semaine dans le futur ; seuls les créneaux réellement libres
// (ni fermés par l'équipe, ni déjà réservés) sont renvoyés par l'API.
const WEEK = 7;
// Heures affichées à l'heure de Paris, comme l'appel lui-même, quel que soit le fuseau du navigateur.
const timeLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value)).replace(":", "h");
const dayTitle = (dayKey: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${dayKey}T12:00:00Z`));
const rangeTitle = (from: string) => {
  const f = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
  return `Du ${f.format(new Date(`${from}T12:00:00Z`))} au ${f.format(new Date(`${addDays(from, WEEK - 1)}T12:00:00Z`))}`;
};

export function CallCalendar({ onSelect, schedulingId, title = "Choisissez votre appel", exclude }: { onSelect: (startsAt: string) => Promise<unknown> | void; schedulingId: string | null; title?: string; exclude?: string }) {
  const today = useMemo(() => parisDayKey(new Date()), []);
  const [from, setFrom] = useState(today);
  const [slots, setSlots] = useState<any[] | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let ignore = false; setSlots(null);
    api<any[]>(`/interview-slots?from=${from}&days=${WEEK}`).then(s => { if (!ignore) setSlots(s.filter(x => x.id !== exclude)); }).catch(() => { if (!ignore) setSlots([]); });
    return () => { ignore = true; };
  }, [from, exclude, reload]);
  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (let i = 0; i < WEEK; i++) map.set(addDays(from, i), []);
    for (const slot of slots ?? []) map.get(parisDayKey(new Date(slot.startsAt)))?.push(slot);
    return map;
  }, [slots, from]);
  const days = [...byDay.keys()];
  useEffect(() => {
    if (!slots) return;
    if (!activeDay || !byDay.has(activeDay) || byDay.get(activeDay)!.length === 0) setActiveDay(days.find(d => byDay.get(d)!.length > 0) ?? days[0]);
  }, [slots]); // eslint-disable-line react-hooks/exhaustive-deps
  const daySlots = byDay.get(activeDay ?? "") ?? [];

  return <div className="calendar">
    <div className="calendar-head">
      <h3>{title}</h3>
      <div className="calendar-nav">
        <button type="button" className="icon-button" aria-label="Semaine précédente" disabled={from <= today} onClick={() => setFrom(f => { const prev = addDays(f, -WEEK); return prev < today ? today : prev; })}><ChevronLeft size={18} aria-hidden="true" /></button>
        <span>{rangeTitle(from)}</span>
        <button type="button" className="icon-button" aria-label="Semaine suivante" onClick={() => setFrom(f => addDays(f, WEEK))}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="calendar-days">{days.map(day => {
      const count = byDay.get(day)!.length;
      return <button type="button" key={day} className={day === activeDay ? "active" : ""} disabled={slots !== null && count === 0} aria-pressed={day === activeDay} onClick={() => setActiveDay(day)}>
        <strong>{dayTitle(day)}</strong><small>{slots === null ? " " : count === 0 ? "Indisponible" : `${count} créneaux`}</small>
      </button>;
    })}</div>
    {slots === null
      ? <div className="calendar-slots" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <span key={i} className="skeleton calendar-slot-skeleton" />)}</div>
      : slots.length === 0
        ? <div className="calendar-state empty-slots"><Inbox size={24} aria-hidden="true" /><p>Aucun créneau libre cette semaine. Passez à la semaine suivante.</p></div>
        : <div className="calendar-slots">{daySlots.map(s => <button type="button" key={s.id} disabled={!!schedulingId} onClick={() => { void Promise.resolve(onSelect(s.id)).finally(() => setReload(r => r + 1)); }}>{timeLabel(s.startsAt)}{schedulingId === s.id ? <i className="mini-spinner" /> : null}</button>)}</div>}
  </div>;
}
