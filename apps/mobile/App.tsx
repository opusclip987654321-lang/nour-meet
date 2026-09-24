// Uniquement les graisses utilisées (import par sous-chemin) : l'index du paquet embarquerait toutes les graisses.
import { BricolageGrotesque_600SemiBold } from "@expo-google-fonts/bricolage-grotesque/600SemiBold";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { HankenGrotesk_400Regular } from "@expo-google-fonts/hanken-grotesk/400Regular";
import { HankenGrotesk_500Medium } from "@expo-google-fonts/hanken-grotesk/500Medium";
import { HankenGrotesk_600SemiBold } from "@expo-google-fonts/hanken-grotesk/600SemiBold";
import { HankenGrotesk_700Bold } from "@expo-google-fonts/hanken-grotesk/700Bold";
import { useFonts } from "expo-font";
import * as PushNotifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { Bell, CalendarDays, Home as HomeIcon, MessageCircle, QrCode, Store, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Platform, Pressable, SafeAreaView, Text, View } from "react-native";
import { api, getToken, setToken, type ApiError } from "./src/api";
import { Logo, openWeb } from "./src/components/ui";
import { Navigate, Route, routeFromPath } from "./src/links";
import { linkPathOf, registerForPush, unregisterPush } from "./src/push";
import { cachedSessionUser, clearTicketCache, saveSessionUser } from "./src/ticket-cache";
import { Blog } from "./src/screens/Blog";
import { Espace } from "./src/screens/Espace";
import { Events } from "./src/screens/Events";
import { Concept, Home } from "./src/screens/Home";
import { Login } from "./src/screens/Login";
import { Messages } from "./src/screens/Messages";
import { Notifications } from "./src/screens/Notifications";
import { RestaurantSpace } from "./src/screens/RestaurantSpace";
import { Scanner } from "./src/screens/Scanner";
import { StaffHome } from "./src/screens/StaffHome";
import { F, T, s } from "./src/theme";

// Navigation de l'application (2026-09-24) : même organisation que le site, avec une barre d'onglets
// (Accueil, Soirées, Scanner, Messages, Mon espace) et la cloche de notifications dans l'en-tête. Toute
// navigation passe par une Route (voir src/links.ts), ce qui permet d'ouvrir directement l'objet visé
// par une notification ou un lien d'article, comme sur le web.
export default function App() {
  const [fontsLoaded] = useFonts({ BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold, HankenGrotesk_700Bold });
  const [loading, setLoading] = useState(true), [user, setUser] = useState<any>(null);
  const [history, setHistory] = useState<Route[]>([{ name: "home" }]);
  const route = history[history.length - 1];
  const [unread, setUnread] = useState(0);
  // Vrai dès que le choix « restaurateur » a été fait à la création du compte, tant que la fiche
  // Restaurant n'existe pas encore côté serveur (même logique que le site).
  const [forceRestaurantSpace, setForceRestaurantSpace] = useState(false);

  const load = useCallback(async () => {
    try {
      if (!await getToken()) { setUser(null); return; }
      const me = await api<any>("/me");
      // Session glissante : jeton neuf de 90 jours renvoyé au plus une fois par jour.
      if (me.refreshedToken) await setToken(me.refreshedToken);
      setUser(me);
      saveSessionUser(me);
    } catch (err) {
      // Seul un refus réel de l'API efface la session : une coupure réseau ne déconnecte jamais
      // (sinon chaque incident obligerait à redemander un code).
      const status = (err as ApiError).status;
      if (status === 401 || status === 403) { await setToken(null); await clearTicketCache(); setUser(null); }
      // Hors connexion : l'application s'ouvre quand même (billets enregistrés, cloche indisponible).
      else if ((err as ApiError).network) { const cached = await cachedSessionUser(); setUser((current: any) => current ?? cached); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const refreshUnread = useCallback(() => { if (user) api<{ count: number }>("/notifications/unread-count").then(r => setUnread(r.count)).catch(() => {}); }, [user]);
  useEffect(() => { refreshUnread(); }, [refreshUnread, route]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => { if (state === "active") refreshUnread(); });
    const timer = setInterval(refreshUnread, 60_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [refreshUnread]);

  const navigate: Navigate = useCallback(target => {
    const next = typeof target === "string" ? routeFromPath(target) : target;
    if (next.name === "web") { openWeb(next.path); return; }
    setHistory(h => [...h.slice(-19), next]);
  }, []);
  const goBack = useCallback(() => { setHistory(h => h.length > 1 ? h.slice(0, -1) : h); return history.length > 1; }, [history.length]);
  const goTab = (next: Route) => setHistory([next]);
  useEffect(() => { if (Platform.OS === "web") return; const sub = BackHandler.addEventListener("hardwareBackPress", goBack); return () => sub.remove(); }, [goBack]);

  // Notification push touchée : ouvre l'objet concerné, y compris au démarrage de l'application
  // (le lien attend alors que la session soit chargée).
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  useEffect(() => {
    PushNotifications.getLastNotificationResponseAsync().then(r => setPendingLink(linkPathOf(r))).catch(() => {});
    const tapped = PushNotifications.addNotificationResponseReceivedListener(r => setPendingLink(linkPathOf(r)));
    const received = PushNotifications.addNotificationReceivedListener(() => refreshUnread());
    return () => { tapped.remove(); received.remove(); };
  }, [refreshUnread]);
  useEffect(() => { if (user && pendingLink) { navigate(pendingLink); setPendingLink(null); refreshUnread(); } }, [user, pendingLink, navigate, refreshUnread]);
  useEffect(() => { if (user?.id) registerForPush().catch(() => { /* notifications facultatives */ }); }, [user?.id]);

  const logout = async () => { await unregisterPush().catch(() => { /* retiré à la prochaine connexion */ }); await setToken(null); await clearTicketCache(); setUser(null); setForceRestaurantSpace(false); setHistory([{ name: "home" }]); };

  if (!fontsLoaded || loading) return <SafeAreaView style={[s.safe, s.center]}><ActivityIndicator color={T.night} /></SafeAreaView>;
  if (!user) return <Login onLogin={opts => { if (opts?.restaurateur) { setForceRestaurantSpace(true); setHistory([{ name: "restaurant", tab: "establishment" }]); } load(); }} />;
  if (["ADMIN", "MODERATOR", "RECEPTION"].includes(user.role)) return <StaffHome user={user} onLogout={logout} />;

  const isRestaurant = user.hasRestaurant || forceRestaurantSpace;
  const tabs: { key: string; label: string; icon: typeof HomeIcon; route: Route; active: boolean }[] = [
    { key: "home", label: "Accueil", icon: HomeIcon, route: { name: "home" }, active: ["home", "concept", "blog"].includes(route.name) },
    { key: "events", label: "Soirées", icon: CalendarDays, route: { name: "events" }, active: route.name === "events" },
    { key: "scan", label: "Scanner", icon: QrCode, route: { name: "scan" }, active: route.name === "scan" },
    { key: "messages", label: "Messages", icon: MessageCircle, route: { name: "messages" }, active: route.name === "messages" },
    isRestaurant
      ? { key: "restaurant", label: "Établissement", icon: Store, route: { name: "restaurant", tab: "establishment" }, active: route.name === "restaurant" }
      : { key: "espace", label: "Mon espace", icon: UserRound, route: { name: "espace", tab: "reservations" }, active: route.name === "espace" }
  ];
  const screen = (() => {
    switch (route.name) {
      case "home": return <Home user={user} navigate={navigate} />;
      case "concept": return <Concept navigate={navigate} />;
      case "blog": return <Blog key={route.slug ?? "list"} slug={route.slug} navigate={navigate} goBack={goBack} />;
      case "events": return <Events key={`${route.slug ?? ""}|${route.category ?? ""}`} user={user} slug={route.slug} category={route.category} navigate={navigate} goBack={goBack} onUserChanged={load} />;
      case "scan": return <Scanner />;
      case "messages": return <Messages user={user} />;
      case "notifications": return <Notifications user={user} navigate={navigate} onChanged={refreshUnread} />;
      case "restaurant": return <RestaurantSpace key={`${route.tab}|${route.focus ?? ""}`} tab={route.tab} focus={route.focus} navigate={navigate} onLogout={logout} />;
      case "espace": return isRestaurant ? <RestaurantSpace tab="establishment" navigate={navigate} onLogout={logout} /> : <Espace key={`${route.tab}|${route.focus ?? ""}`} user={user} tab={route.tab} focus={route.focus} navigate={navigate} onUserChanged={load} onLogout={logout} />;
      default: return null;
    }
  })();

  return <SafeAreaView style={s.safe}>
    <StatusBar style="dark" />
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Nūr Meet — accueil" onPress={() => goTab({ name: "home" })}><Logo /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={unread > 0 ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"} onPress={() => navigate({ name: "notifications" })} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }} testID="notification-bell">
        <Bell size={24} color={T.ink} />
        {unread > 0 && <View style={{ position: "absolute", top: 4, right: 2, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: T.danger, borderWidth: 2, borderColor: T.surface, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily: F.textBold, fontSize: 11, color: "#fff" }}>{unread > 99 ? "99+" : unread}</Text></View>}
      </Pressable>
    </View>
    <View style={{ flex: 1 }}>{screen}</View>
    <View style={s.tabBar}>
      {tabs.map(tab => {
        const Icon = tab.icon;
        return <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: tab.active }} accessibilityLabel={tab.label} onPress={() => goTab(tab.route)} style={s.tabItem}>
          <Icon size={22} color={tab.active ? T.night : T.ink3} strokeWidth={tab.active ? 2.4 : 1.8} />
          <Text style={[s.tabLabel, tab.active && { color: T.night }]}>{tab.label}</Text>
          {tab.active && <View style={{ position: "absolute", top: -8, width: 28, height: 3, borderRadius: 2, backgroundColor: T.saffron }} />}
        </Pressable>;
      })}
    </View>
  </SafeAreaView>;
}
