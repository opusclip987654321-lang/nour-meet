import { VideoView, useVideoPlayer } from "expo-video";
import { ArrowRight, BadgeCheck, CalendarDays, Handshake, Heart, Lock, MessageCircleHeart, PlayCircle, QrCode, Ticket, Undo2, Users } from "lucide-react-native";
import { ReactNode, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { Button, EventCard, Skeleton } from "../components/ui";
import { shortDate } from "../format";
import { Navigate } from "../links";
import { F, R, S, T, s } from "../theme";
import { loadTickets } from "../ticket-cache";

// Accueil de l'application, aligné sur celui du site (pages/Home.tsx) : mêmes promesses, uniquement des
// mécanismes réellement en place dans le produit.
function Step({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <View style={{ flexDirection: "row", gap: S[3] }}>
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: T.saffronSoft, alignItems: "center", justifyContent: "center" }}>{icon}</View>
    <View style={{ flex: 1, gap: 2 }}><Text style={s.bodyStrong}>{title}</Text><Text style={s.small}>{text}</Text></View>
  </View>;
}

export function Home({ user, navigate }: { user: any; navigate: Navigate }) {
  const [events, setEvents] = useState<any[] | null>(null), [tickets, setTickets] = useState<any[]>([]);
  useEffect(() => {
    api<{ items: any[] }>("/events?pageSize=3").then(r => setEvents(r.items)).catch(() => setEvents([]));
    loadTickets().then(r => setTickets(r.tickets)).catch(() => {});
  }, []);
  const next = tickets.find(t => new Date(t.reservation.event.startsAt) > new Date());
  return <ScrollView contentContainerStyle={[s.content, { paddingTop: 0, paddingHorizontal: 0 }]}>
    <View style={{ backgroundColor: T.night, padding: S[5], paddingBottom: S[6], gap: S[4] }}>
      <Text style={[s.meta, { color: T.onNight2 }]}>Bonjour {user.displayName}</Text>
      <Text style={[s.display, { color: T.onNight }]}>Rencontrer quelqu’un de sérieux, autour d’une vraie table.</Text>
      <Text style={[s.body, { color: T.onNight2 }]}>Des soirées en petit comité, dans des restaurants partenaires à Paris, entre personnes qui partagent vos valeurs.</Text>
      <Button title="Voir les prochaines soirées" variant="accent" icon={<ArrowRight size={18} color={T.ink} />} onPress={() => navigate({ name: "events" })} />
      {next && <Pressable accessibilityRole="button" onPress={() => navigate({ name: "espace", tab: "tickets", focus: next.reservationId })} style={{ flexDirection: "row", alignItems: "center", gap: S[3], backgroundColor: T.night2, borderRadius: R.md, padding: S[3] }}>
        <Image source={{ uri: next.qrDataUrl }} style={{ width: 56, height: 56, borderRadius: 6, backgroundColor: T.surface }} />
        <View style={{ flex: 1 }}><Text style={{ fontFamily: F.textSemi, color: T.saffron, fontSize: 13 }}>Votre prochaine soirée</Text><Text style={{ fontFamily: F.textSemi, color: T.onNight, fontSize: 15 }}>{next.reservation.event.title}</Text><Text style={{ fontFamily: F.text, color: T.onNight2, fontSize: 13 }}>{shortDate(next.reservation.event.startsAt)}</Text></View>
        <Ticket size={20} color={T.onNight2} />
      </Pressable>}
    </View>
    <View style={{ paddingHorizontal: S[5], gap: S[4] }}>
      <View style={[s.row, { justifyContent: "space-between", marginTop: S[4] }]}><Text style={s.h2}>Prochaines soirées</Text><Pressable onPress={() => navigate({ name: "events" })}><Text style={s.link}>Tout voir</Text></Pressable></View>
      {events === null ? <><Skeleton height={260} /><Skeleton height={260} /></> : events.length === 0
        ? <View style={s.panel}><CalendarDays size={22} color={T.ink3} /><Text style={s.bodyStrong}>Prochaines soirées bientôt annoncées</Text><Text style={s.small}>De nouvelles dates sont publiées régulièrement.</Text></View>
        : events.map(e => <EventCard key={e.id} event={e} onPress={() => navigate({ name: "events", slug: e.slug })} />)}
      <Text style={[s.h2, { marginTop: S[4] }]}>Deux façons de venir</Text>
      <Pressable onPress={() => navigate({ name: "events", category: "Speed dating" })} style={s.card}><View style={s.row}><Heart size={18} color={T.rencontre} /><Text style={s.h3}>Des rencontres en vue d’une relation sérieuse</Text></View><Text style={s.small}>Des tête-à-tête courts et animés, puis des temps libres. Chaque participant a été validé lors d’un entretien.</Text><Text style={s.link}>Voir les soirées de rencontre</Text></Pressable>
      <Pressable onPress={() => navigate({ name: "events", category: "Networking" })} style={s.card}><View style={s.row}><Users size={18} color={T.networking} /><Text style={s.h3}>Élargir son réseau, entre professionnels</Text></View><Text style={s.small}>Entrepreneurs, salariés, indépendants : inscription directe, sans entretien préalable.</Text><Text style={s.link}>Voir les soirées networking</Text></Pressable>
      <Text style={[s.h2, { marginTop: S[4] }]}>Comment ça marche</Text>
      <View style={[s.panel, { gap: S[4] }]}>
        <Step icon={<BadgeCheck size={20} color={T.saffronInk} />} title="Créez votre compte" text="Avec Google ou votre adresse e-mail, sans mot de passe. Votre numéro est vérifié une seule fois par SMS avant votre première réservation." />
        <Step icon={<Handshake size={20} color={T.saffronInk} />} title="Faites-vous valider" text="Pour les rencontres : un court entretien avec l’équipe, une seule fois. Le networking est en accès direct." />
        <Step icon={<QrCode size={20} color={T.saffronInk} />} title="Réservez votre place" text="Paiement sécurisé. Votre billet avec QR code arrive dans votre espace dès la confirmation." />
        <Step icon={<MessageCircleHeart size={20} color={T.saffronInk} />} title="Gardez le contact, si vous le voulez tous les deux" text="La conversation s’ouvre seulement si l’autre personne accepte." />
      </View>
      <View style={[s.panel, { gap: S[3] }]}>
        <View style={s.row}><Lock size={18} color={T.success} /><Text style={s.bodyStrong}>Vos coordonnées restent privées</Text></View>
        <View style={s.row}><Undo2 size={18} color={T.success} /><Text style={[s.bodyStrong, { flex: 1 }]}>Annulation gratuite jusqu’à 24 h avant la soirée</Text></View>
      </View>
      <View style={[s.row, { gap: S[5] }]}>
        <Pressable onPress={() => navigate({ name: "concept" })}><Text style={s.link}>Comment ça marche en détail</Text></Pressable>
        <Pressable onPress={() => navigate({ name: "blog" })}><Text style={s.link}>Le journal</Text></Pressable>
      </View>
    </View>
  </ScrollView>;
}

// « Comment ça marche » : le parcours réel de chaque format, comme la page Concept du site.
export function Concept({ navigate }: { navigate: Navigate }) {
  const [video, setVideo] = useState<{ url: string } | null>(null);
  useEffect(() => { api<{ url: string }>("/concept-video").then(setVideo).catch(() => {}); }, []);
  const player = useVideoPlayer(null, p => { p.loop = false; });
  useEffect(() => { if (video?.url) player.replace(video.url); }, [video?.url, player]);
  const sections: [string, string[]][] = [
    ["Pour une rencontre sérieuse", ["Profil et questionnaire privé, jamais transmis au restaurant ni aux autres participants.", "Un court entretien de validation avec l’équipe, une seule fois : il vaut pour toutes les soirées de rencontre suivantes.", "Des tête-à-tête courts et animés, puis des temps libres, avec l’équipe présente du début à la fin."]],
    ["Pour élargir son réseau", ["Inscription directe, sans entretien.", "Après confirmation, un questionnaire facultatif aide l’organisateur à préparer la soirée."]],
    ["Réserver, payer, venir", ["Le prix affiché est le prix final ; ce qui est compris figure sur chaque fiche.", "Paiement par carte via Stripe. La place n’est acquise qu’une fois le paiement confirmé.", "Votre billet avec QR code arrive aussitôt dans votre espace.", "Annulation gratuite jusqu’à 24 heures avant la soirée, avec remboursement intégral et automatique."]],
    ["Après la soirée, c’est vous qui décidez", ["Vous pouvez demander à revoir quelqu’un : la conversation ne s’ouvre que si la personne accepte.", "Personne ne voit votre numéro de téléphone ni votre e-mail."]]
  ];
  return <ScrollView contentContainerStyle={s.content}>
    <Text style={s.h1} accessibilityRole="header">Comment fonctionne Nūr Meet</Text>
    <Text style={s.body}>Des soirées en petit comité, dans des restaurants partenaires à Paris. Vous choisissez une soirée, vous réservez votre place, l’équipe s’occupe du reste.</Text>
    {video?.url ? <VideoView player={player} style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: R.md }} nativeControls />
      : <View style={[s.panel, s.center]}><PlayCircle size={32} color={T.ink3} /><Text style={[s.small, { textAlign: "center" }]}>La vidéo de présentation arrive bientôt. En attendant, tout est expliqué ci-dessous.</Text></View>}
    {sections.map(([title, items]) => <View key={title} style={s.panel}><Text style={s.h3}>{title}</Text>{items.map(item => <View key={item} style={{ flexDirection: "row", gap: S[2] }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.saffron, marginTop: 8 }} /><Text style={[s.small, { flex: 1 }]}>{item}</Text></View>)}</View>)}
    <Button title="Voir les prochaines soirées" onPress={() => navigate({ name: "events" })} />
  </ScrollView>;
}
