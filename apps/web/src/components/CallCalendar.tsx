import { Inbox } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { dayLabel, timeLabel } from "../lib/format";

export function CallCalendar({ slots, loading, onSelect, schedulingId }: { slots: any[]; loading: boolean; onSelect: (id: string) => void; schedulingId: string | null }) {
  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const slot of slots) {
      const key = new Date(slot.startsAt).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return map;
  }, [slots]);
  const days = useMemo(() => [...byDay.keys()], [byDay]);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  useEffect(() => { if (days.length && !days.includes(activeDay ?? "")) setActiveDay(days[0]); }, [days.join(",")]);
  if (loading) return <div className="calendar-state"><div className="spinner small"/><span>Chargement des disponibilités…</span></div>;
  if (!slots.length) return <div className="calendar-state empty-slots"><Inbox size={24} aria-hidden="true"/><p>Aucun créneau disponible pour le moment. L’équipe Nūr Meet publie régulièrement de nouveaux créneaux : revenez un peu plus tard.</p></div>;
  return <div className="calendar"><h3>Choisissez votre appel</h3><div className="calendar-days">{days.map(day => <button type="button" key={day} className={day===activeDay?"active":""} onClick={()=>setActiveDay(day)}><strong>{dayLabel(day)}</strong></button>)}</div><div className="calendar-slots">{(byDay.get(activeDay ?? "")??[]).map(s => <button type="button" key={s.id} disabled={schedulingId===s.id} onClick={()=>onSelect(s.id)}>{timeLabel(s.startsAt)}{schedulingId===s.id?<i className="mini-spinner"/>:null}</button>)}</div></div>;
}
