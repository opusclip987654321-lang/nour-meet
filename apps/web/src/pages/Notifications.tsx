import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Layout } from "../components/Layout";
import { Notice } from "../components/ui";
import { dateTime } from "../lib/format";
import { AppNotification, announceNotificationsChanged, markAllNotificationsRead, markNotificationRead, notificationHref } from "../lib/notifications";

// Page complète des notifications (corrections web 2026-09-24, §4.2), commune à tous les comptes :
// chaque ligne mène à l'objet concerné (§4.3), avec la même règle que la cloche de l'en-tête.
export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<AppNotification[]>("/notifications?limit=100").then(setItems).catch(err => { setError((err as Error).message); setItems([]); }); }, []);
  const open = async (n: AppNotification) => {
    if (!n.readAt) { await markNotificationRead(n.id); announceNotificationsChanged(); }
    navigate(notificationHref(n, user?.role));
  };
  const readAll = async () => {
    try { await markAllNotificationsRead(); setItems(prev => prev?.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev); announceNotificationsChanged(); }
    catch (err) { setError((err as Error).message); }
  };
  const unread = items?.filter(n => !n.readAt).length ?? 0;
  return <Layout><section className="page narrow">
    <div className="page-heading-row"><h1>Notifications</h1>{unread > 0 && <button type="button" className="button secondary small" onClick={readAll}>Tout marquer comme lu</button>}</div>
    {error && <Notice kind="error">{error}</Notice>}
    {items === null
      ? <div className="stack" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 76 }} />)}</div>
      : items.length === 0
        ? <div className="empty"><Bell size={24} aria-hidden="true" /><h2>Aucune notification</h2><p>Vous serez prévenu(e) ici de chaque étape : inscription, paiement, liste d’attente, entretien.</p></div>
        : <ul className="notification-page-list">{items.map(n => <li key={n.id}>
          <button type="button" className={`notification ${n.readAt ? "read" : "unread"}`} onClick={() => open(n)}>
            <i aria-hidden="true" /><div><h3>{n.title}</h3><p>{n.body}</p><small>{dateTime(n.createdAt)}{n.readAt ? "" : " · non lue"}</small></div>
          </button>
        </li>)}</ul>}
  </section></Layout>;
}
