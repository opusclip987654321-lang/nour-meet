import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { API_URL, WEB_URL } from "./env";

export { API_URL, WEB_URL };
// Jeton de session dans le trousseau du téléphone (Keychain iOS, Keystore Android) plutôt qu'en clair
// dans AsyncStorage. Un jeton enregistré par une version précédente y est déplacé à la première
// lecture. Le navigateur (version web de test) n'a pas de trousseau : AsyncStorage y reste utilisé.
const TOKEN_KEY = "nour_token";
const secure = Platform.OS !== "web";
let cached: string | null | undefined;
export const getToken = async () => {
  if (cached !== undefined) return cached;
  if (!secure) return (cached = await AsyncStorage.getItem(TOKEN_KEY));
  let token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (!token) {
    const legacy = await AsyncStorage.getItem(TOKEN_KEY);
    if (legacy) { await SecureStore.setItemAsync(TOKEN_KEY, legacy); await AsyncStorage.removeItem(TOKEN_KEY); token = legacy; }
  }
  return (cached = token);
};
export const setToken = async (token: string | null) => {
  cached = token;
  if (!secure) { await (token ? AsyncStorage.setItem(TOKEN_KEY, token) : AsyncStorage.removeItem(TOKEN_KEY)); return; }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else { await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}); await AsyncStorage.removeItem(TOKEN_KEY); }
};

// Erreur de l'API : message en français à afficher, statut HTTP (401/403 = session refusée) et
// indications destinées à l'écran (ex. phoneVerificationRequired, notBookable).
export type ApiError = Error & { status?: number; network?: boolean; phoneVerificationRequired?: boolean; notBookable?: boolean; waitlisted?: boolean };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  // FormData (upload photo) ne doit jamais recevoir de Content-Type manuel : fetch calcule seul la
  // boundary multipart, la même règle que côté web (voir apps/web/src/api.ts).
  const isFormData = init.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } })
    .catch(() => { throw Object.assign(new Error("Connexion au serveur impossible. Vérifiez votre connexion internet puis réessayez."), { network: true }); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Une erreur est survenue"), data, { status: response.status }) as ApiError;
  return data;
}
