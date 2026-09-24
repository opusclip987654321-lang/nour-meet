import { ArrowLeft, Check, MessageCircle, Send, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { Avatar, Button, Empty, Notice, Skeleton } from "../components/ui";
import { F, R, S, T, s } from "../theme";

// Mise en relation après une soirée (même logique que ContactsPanel côté site) : demandes reçues à
// accepter ou décliner, demandes envoyées, puis conversations — une conversation ne s'ouvre qu'après
// acceptation, et une conversation bloquée par un signalement reste en lecture seule.
const STATUS_LABEL: Record<string, string> = { PENDING: "En attente de réponse", ACCEPTED: "Acceptée", REFUSED: "Déclinée", CANCELLED: "Annulée" };
const time = (v: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v));

export function Messages({ user }: { user: any }) {
  const [requests, setRequests] = useState<any[] | null>(null), [conversations, setConversations] = useState<any[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const load = useCallback(() => {
    api<any[]>("/me/contact-requests").then(setRequests).catch(() => setRequests([]));
    api<any[]>("/conversations").then(setConversations).catch(() => setConversations([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  const respond = async (id: string, accept: boolean) => {
    setBusy(id); setError("");
    try { await api(`/contacts/${id}/respond`, { method: "POST", body: JSON.stringify({ accept }) }); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };
  const other = (c: any) => c.members.find((m: any) => m.userId !== user.id);
  const active = conversations?.find(c => c.id === activeId);
  if (active) return <Chat conversation={active} user={user} other={other(active)?.user} onBack={() => { setActiveId(null); load(); }} />;

  const incoming = requests?.filter(r => r.recipientId === user.id && r.status === "PENDING") ?? [];
  const sent = requests?.filter(r => r.requesterId === user.id) ?? [];
  return <ScrollView contentContainerStyle={s.content}>
    <Text style={s.h1} accessibilityRole="header">Messages</Text>
    {error ? <Notice kind="error">{error}</Notice> : null}
    {incoming.length > 0 && <View style={s.panel}>
      <Text style={s.h3}>Demandes reçues</Text>
      {incoming.map(r => <View key={r.id} style={{ gap: S[2] }}>
        <View style={s.row}><Avatar name={r.requester.displayName} photoUrl={r.requester.profile?.photoUrl} size={40} /><View style={{ flex: 1 }}><Text style={s.bodyStrong}>{r.requester.displayName}</Text><Text style={s.meta}>souhaite rester en contact · {time(r.createdAt)}</Text></View></View>
        <View style={s.row}>
          <Button small title="Accepter" busy={busy === r.id} icon={<Check size={16} color={T.onNight} />} onPress={() => respond(r.id, true)} />
          <Button small variant="secondary" title="Décliner" disabled={busy === r.id} icon={<X size={16} color={T.ink} />} onPress={() => respond(r.id, false)} />
        </View>
      </View>)}
    </View>}
    {conversations === null ? [0, 1].map(i => <Skeleton key={i} height={72} />)
      : conversations.length === 0 ? <Empty icon={<MessageCircle size={24} color={T.ink3} />} title="Aucune conversation pour le moment" text="Une conversation s’ouvre dès qu’une demande de contact est acceptée. Scannez le code d’une personne rencontrée pour lui en envoyer une." />
        : conversations.map(c => { const o = other(c); return <Pressable key={c.id} accessibilityRole="button" onPress={() => setActiveId(c.id)} style={({ pressed }) => [s.card, { flexDirection: "row", alignItems: "center", gap: S[3], opacity: pressed ? 0.85 : 1 }]}>
          <Avatar name={o?.user.displayName ?? "?"} photoUrl={o?.user.profile?.photoUrl} />
          <View style={{ flex: 1, minWidth: 0 }}><Text style={s.bodyStrong}>{o?.user.displayName ?? "Participant"}</Text><Text style={s.meta} numberOfLines={1}>{c.messages[0]?.body ?? "Nouvelle conversation"}</Text></View>
        </Pressable>; })}
    {sent.length > 0 && <View style={s.panel}>
      <Text style={s.h3}>Demandes envoyées</Text>
      {sent.map(r => <View key={r.id} style={s.row}><Avatar name={r.recipient.displayName} photoUrl={r.recipient.profile?.photoUrl} size={40} /><View style={{ flex: 1 }}><Text style={s.bodyStrong}>{r.recipient.displayName}</Text><Text style={s.meta}>{STATUS_LABEL[r.status]} · {time(r.createdAt)}</Text></View></View>)}
    </View>}
  </ScrollView>;
}

function Chat({ conversation, user, other, onBack }: { conversation: any; user: any; other: any; onBack: () => void }) {
  const [messages, setMessages] = useState<any[] | null>(null), [body, setBody] = useState(""), [error, setError] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const blocked = !!conversation.members.find((m: any) => m.userId === user.id)?.blockedAt;
  // Rafraîchissement léger toutes les 10 s (pas de temps réel côté API), comme sur le site.
  useEffect(() => {
    const loadMessages = () => api<any[]>(`/conversations/${conversation.id}/messages`).then(setMessages).catch(() => {});
    loadMessages();
    const t = setInterval(loadMessages, 10_000);
    return () => clearInterval(t);
  }, [conversation.id]);
  const send = async () => {
    if (!body.trim()) return; setError("");
    try { const m = await api<any>(`/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ body: body.trim() }) }); setMessages(list => [...(list ?? []), m]); setBody(""); }
    catch (e) { setError((e as Error).message); }
  };
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={60}>
    <View style={[s.row, { paddingHorizontal: S[4], paddingVertical: S[2], backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Retour aux conversations" onPress={onBack} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><ArrowLeft size={22} color={T.ink} /></Pressable>
      <Avatar name={other?.displayName ?? "?"} photoUrl={other?.profile?.photoUrl} size={36} />
      <Text style={s.bodyStrong}>{other?.displayName}</Text>
    </View>
    <ScrollView ref={scrollRef} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ padding: S[4], gap: S[2] }}>
      {messages === null ? <Skeleton height={48} width="60%" /> : messages.length === 0 ? <Text style={[s.meta, { textAlign: "center" }]}>Dites bonjour : c’est le début de votre conversation.</Text>
        : messages.map(m => { const mine = m.senderId === user.id; return <View key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%", backgroundColor: mine ? T.night : T.surface, borderWidth: mine ? 0 : 1, borderColor: T.line, borderRadius: R.md, paddingHorizontal: S[3], paddingVertical: S[2], gap: 2 }}>
          <Text style={{ fontFamily: F.text, fontSize: 15, lineHeight: 21, color: mine ? T.onNight : T.ink }}>{m.body}</Text>
          <Text style={{ fontFamily: F.text, fontSize: 11, color: mine ? T.onNight2 : T.ink3 }}>{time(m.createdAt)}</Text>
        </View>; })}
    </ScrollView>
    {error ? <View style={{ paddingHorizontal: S[4] }}><Notice kind="error">{error}</Notice></View> : null}
    {blocked ? <Text style={[s.meta, { textAlign: "center", padding: S[4], paddingBottom: 96 }]}>Cette conversation est fermée.</Text>
      : <View style={[s.row, { padding: S[3], paddingBottom: 90, backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.line }]}>
        <TextInput style={[s.input, { flex: 1 }]} value={body} onChangeText={setBody} maxLength={2000} placeholder="Écrire un message…" placeholderTextColor={T.ink3} accessibilityLabel="Votre message" />
        <Pressable accessibilityRole="button" accessibilityLabel="Envoyer" disabled={!body.trim()} onPress={send} style={{ width: 50, height: 50, borderRadius: R.sm, backgroundColor: body.trim() ? T.night : T.lineStrong, alignItems: "center", justifyContent: "center" }}><Send size={20} color={T.onNight} /></Pressable>
      </View>}
  </KeyboardAvoidingView>;
}
