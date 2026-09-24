import { Bell } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { Button, Empty, Skeleton } from "../components/ui";
import { relativeTime } from "../format";
import { Navigate } from "../links";
import { F, R, S, T, s } from "../theme";

// Notifications (2026-09-24) : ouvertes depuis la cloche de l'en-tête. Chacune mène à l'objet concerné
// (inscription, billet, soirée, entretien…) grâce au chemin posé par l'API, comme sur le site.
export function Notifications({ user, navigate, onChanged }: { user: any; navigate: Navigate; onChanged: () => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>("/notifications?limit=100").then(setItems).catch(() => setItems([])); }, []);
  const open = async (n: any) => {
    if (!n.readAt) { await api(`/notifications/${n.id}/read`, { method: "POST" }).catch(() => {}); onChanged(); }
    navigate(n.linkPath ?? (user.hasRestaurant ? "/restaurant" : "/dashboard?tab=reservations"));
  };
  const readAll = async () => { await api("/notifications/read-all", { method: "POST" }).catch(() => {}); setItems(prev => prev?.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev); onChanged(); };
  const unread = items?.filter(n => !n.readAt).length ?? 0;
  return <ScrollView contentContainerStyle={s.content}>
    <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.h1} accessibilityRole="header">Notifications</Text>{unread > 0 && <Button small variant="secondary" title="Tout marquer comme lu" onPress={readAll} />}</View>
    {items === null ? [0, 1, 2].map(i => <Skeleton key={i} height={76} />)
      : items.length === 0 ? <Empty icon={<Bell size={24} color={T.ink3} />} title="Aucune notification" text="Vous serez prévenu(e) ici de chaque étape : inscription, paiement, liste d’attente, entretien." />
        : items.map(n => <Pressable key={n.id} accessibilityRole="button" onPress={() => open(n)} style={({ pressed }) => [s.card, { flexDirection: "row", gap: S[3], opacity: pressed ? 0.85 : 1 }, !n.readAt && { borderColor: T.saffron }]}>
          <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: n.readAt ? T.lineStrong : T.saffron }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: F.textSemi, fontSize: 15, color: T.ink }}>{n.title}</Text>
            <Text style={s.small}>{n.body}</Text>
            <Text style={s.meta}>{relativeTime(n.createdAt)}{n.readAt ? "" : " · non lue"}</Text>
          </View>
        </Pressable>)}
  </ScrollView>;
}
