export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function getToken() { return localStorage.getItem("nour_token"); }
export function setToken(token: string | null) { if (token) localStorage.setItem("nour_token", token); else localStorage.removeItem("nour_token"); }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isFormData = init.body instanceof FormData;
  // §18 (corrections web 2026-09-24) : une coupure réseau ou un serveur injoignable affiche un message
  // clair en français, jamais le « Failed to fetch » brut du navigateur.
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) }
  }).catch(() => { throw Object.assign(new Error("Connexion au serveur impossible. Vérifiez votre connexion internet puis réessayez."), { network: true }); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Une erreur est survenue"), data, { status: response.status });
  return data;
}
