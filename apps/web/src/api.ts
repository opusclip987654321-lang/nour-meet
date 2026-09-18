const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function getToken() { return localStorage.getItem("nour_token"); }
export function setToken(token: string | null) { token ? localStorage.setItem("nour_token", token) : localStorage.removeItem("nour_token"); }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Une erreur est survenue");
  return data;
}
