import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, WEB_URL } from "./env";

export { API_URL, WEB_URL };
const TOKEN_KEY = "nour_token";
export const getToken = () => AsyncStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) => token ? AsyncStorage.setItem(TOKEN_KEY, token) : AsyncStorage.removeItem(TOKEN_KEY);

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
