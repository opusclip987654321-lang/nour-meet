import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
// Sert à ouvrir la page de paiement web dans un navigateur intégré (voir PayStandalone côté web) :
// Stripe n'a pas de module natif installable dans Expo Go, donc le paiement carte réutilise la
// page web déjà testée plutôt que de dupliquer son intégration Stripe en React Native.
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:5173";
const TOKEN_KEY = "nour_token";
export const getToken = () => AsyncStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) => token ? AsyncStorage.setItem(TOKEN_KEY, token) : AsyncStorage.removeItem(TOKEN_KEY);

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  // FormData (upload photo) ne doit jamais recevoir de Content-Type manuel : fetch calcule seul la
  // boundary multipart, la même règle que côté web (voir apps/web/src/api.ts).
  const isFormData = init.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Une erreur est survenue");
  return data;
}
