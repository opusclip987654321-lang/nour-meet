import { addDays, parisDayKey } from "@nour/shared";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { S, T, s } from "../theme";
import { Chip } from "./ui";

// Calendrier des entretiens (v2 §11), même logique que le site : ouvert tous les jours de 10h à 22h par
// quarts d'heure, navigation semaine par semaine, seuls les créneaux libres sont renvoyés par l'API.
const WEEK = 7;
const dayTitle = (dayKey: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${dayKey}T12:00:00Z`));
const timeLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value)).replace(":", "h");

export function CallCalendar({ onSelect, schedulingId, title = "Choisissez votre appel", exclude }: { onSelect: (startsAt: string) => Promise<unknown>; schedulingId: string | null; title?: string; exclude?: string }) {
  const today = useMemo(() => parisDayKey(new Date()), []);
  const [from, setFrom] = useState(today);
  const [slots, setSlots] = useState<any[] | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let ignore = false; setSlots(null);
    api<any[]>(`/interview-slots?from=${from}&days=${WEEK}`).then(list => { if (!ignore) setSlots(list.filter(x => x.id !== exclude)); }).catch(() => { if (!ignore) setSlots([]); });
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
    if (!activeDay || !byDay.get(activeDay)?.length) setActiveDay(days.find(d => byDay.get(d)!.length > 0) ?? days[0]);
  }, [slots]); // eslint-disable-line react-hooks/exhaustive-deps
  const canGoBack = from > today;
  return <View style={[s.panel, { gap: S[3] }]}>
    <Text style={s.h3}>{title}</Text>
    <View style={[s.row, { justifyContent: "space-between" }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Semaine précédente" disabled={!canGoBack} onPress={() => setFrom(f => { const prev = addDays(f, -WEEK); return prev < today ? today : prev; })} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: canGoBack ? 1 : 0.4 }}><ChevronLeft size={20} color={T.ink} /></Pressable>
      <Text style={s.small}>{dayTitle(from)} – {dayTitle(addDays(from, WEEK - 1))}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Semaine suivante" onPress={() => setFrom(f => addDays(f, WEEK))} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><ChevronRight size={20} color={T.ink} /></Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S[2] }}>{days.map(day => <Chip key={day} label={dayTitle(day)} active={activeDay === day} onPress={() => { if (byDay.get(day)!.length) setActiveDay(day); }} />)}</ScrollView>
    {slots === null ? <ActivityIndicator color={T.night} />
      : slots.length === 0 ? <Text style={s.small}>Aucun créneau libre cette semaine. Passez à la semaine suivante.</Text>
        : (byDay.get(activeDay ?? "") ?? []).length === 0 ? <Text style={s.small}>Aucun créneau libre ce jour-là.</Text>
          : <View style={[s.row, { flexWrap: "wrap" }]}>{(byDay.get(activeDay ?? "") ?? []).map(slot => <Chip key={slot.id} label={schedulingId === slot.id ? "…" : timeLabel(slot.startsAt)} active={false} onPress={() => { if (schedulingId) return; void onSelect(slot.id).finally(() => setReload(r => r + 1)); }} />)}</View>}
  </View>;
}
