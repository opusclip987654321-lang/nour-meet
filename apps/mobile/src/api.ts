import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "nour_token";
export const getToken = () => AsyncStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) => token ? AsyncStorage.setItem(TOKEN_KEY, token) : AsyncStorage.removeItem(TOKEN_KEY);

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Une erreur est survenue");
  return data;
}
