import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, type ApiError } from "./api";
import { ticketsStillUseful as stillUseful } from "./format";

// Billets disponibles hors connexion (2026-09-24) : le réseau passe souvent mal à l'entrée d'un
// restaurant. Chaque chargement réussi est enregistré sur le téléphone ; sans réseau, on affiche la
// dernière copie (seulement les soirées pas encore passées). Effacé à la déconnexion.
const KEY = "nour_tickets_cache";
type Cached = { savedAt: string; tickets: any[] };


export const loadTickets = async (): Promise<{ tickets: any[]; offlineSince?: string }> => {
  try {
    const tickets = await api<any[]>("/me/tickets");
    AsyncStorage.setItem(KEY, JSON.stringify({ savedAt: new Date().toISOString(), tickets: stillUseful(tickets) } satisfies Cached)).catch(() => {});
    return { tickets };
  } catch (err) {
    if (!(err as ApiError).network) throw err;
    const raw = await AsyncStorage.getItem(KEY).catch(() => null);
    if (!raw) throw err;
    const cached = JSON.parse(raw) as Cached;
    return { tickets: stillUseful(cached.tickets), offlineSince: cached.savedAt };
  }
};

export const clearTicketCache = () => AsyncStorage.multiRemove([KEY, "nour_me_cache"]).catch(() => {});

// Profil minimal gardé pour ouvrir l'application sans réseau (billets hors connexion) : jamais les
// coordonnées, seulement de quoi afficher les bons onglets.
const ME_KEY = "nour_me_cache";
export const saveSessionUser = (me: any) => AsyncStorage.setItem(ME_KEY, JSON.stringify({ id: me.id, displayName: me.displayName, role: me.role, hasRestaurant: me.hasRestaurant, phoneVerified: me.phoneVerified, profile: me.profile ? { validatedAt: me.profile.validatedAt } : null })).catch(() => {});
export const cachedSessionUser = async () => { try { const raw = await AsyncStorage.getItem(ME_KEY); return raw ? { ...JSON.parse(raw), offline: true } : null; } catch { return null; } };
