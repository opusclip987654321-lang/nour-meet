import type { SessionUser } from "@nour/shared";
import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";

type AuthState = { user: (SessionUser & {profile?: any}) | null; loading: boolean; refresh: () => Promise<void>; logout: () => void };
const AuthContext = createContext<AuthState>(null as never);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null); const [loading, setLoading] = useState(true);
  const refresh = async () => { const sent = getToken(); if (!sent) { setUser(null); setLoading(false); return; } try {
    // Session glissante : l'API renvoie au plus une fois par jour un jeton neuf de 90 jours.
    const me = await api<SessionUser & { refreshedToken?: string }>("/me");
    if (me.refreshedToken) setToken(me.refreshedToken);
    setUser(me);
  } catch (err) {
    // Seul un refus réel de l'API (jeton expiré, compte suspendu ou supprimé) efface la session. Une
    // panne réseau ou un redémarrage de l'API ne déconnecte jamais : sinon chaque incident
    // obligerait à redemander un code SMS (coût Twilio). L'utilisateur reste simplement non chargé.
    const status = (err as { status?: number }).status;
    // Seulement si le jeton refusé est toujours celui en place : la page /pay a pu en poser un
    // nouveau pendant l'appel, qu'une réponse tardive ne doit jamais effacer.
    if ((status === 401 || status === 403) && getToken() === sent) setToken(null);
    setUser(null);
  } finally { setLoading(false); } };
  useEffect(() => { refresh(); }, []);
  return <AuthContext.Provider value={{ user, loading, refresh, logout: () => { setToken(null); setUser(null); } }}>{children}</AuthContext.Provider>;
}

export const STAFF_ROLES = ["ADMIN","ORGANIZER","MODERATOR","RECEPTION"];
