import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

// Notifications push (2026-09-24) : même contenu que la cloche (titre, phrase, chemin de l'objet
// concerné), reçu même application fermée. L'autorisation n'est demandée qu'une fois connecté ; un
// refus n'empêche rien, la cloche reste la source de vérité.
const KEY = "nour_push_token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false })
});

export const registerForPush = async () => {
  // Jeton d'un compte précédent resté noté après une déconnexion hors ligne : il est réattribué
  // ci-dessous au compte connecté, jamais laissé à l'ancien.
  // Simulateur, navigateur ou build sans projet EAS : pas de jeton Expo possible.
  if (Platform.OS === "web" || !Device.isDevice) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Nūr Meet", importance: Notifications.AndroidImportance.DEFAULT, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api("/me/push-tokens", { method: "POST", body: JSON.stringify({ token, platform: Platform.OS }) });
  await AsyncStorage.setItem(KEY, token);
};

// À la déconnexion : cet appareil ne doit plus recevoir les notifications du compte.
export const unregisterPush = async () => {
  const token = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!token) return;
  // Sans réseau, le jeton reste noté : il sera retiré à la prochaine connexion de ce téléphone.
  await api("/me/push-tokens", { method: "DELETE", body: JSON.stringify({ token }) });
  await AsyncStorage.removeItem(KEY).catch(() => {});
};

// Chemin de l'objet visé par une notification touchée (posé par l'API, voir services/links.ts).
export const linkPathOf = (response: Notifications.NotificationResponse | null) => {
  const linkPath = response?.notification.request.content.data?.linkPath;
  return typeof linkPath === "string" && linkPath.startsWith("/") ? linkPath : null;
};
