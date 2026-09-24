import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { AppNotification, NOTIFICATIONS_CHANGED, announceNotificationsChanged, markAllNotificationsRead, markNotificationRead, notificationHref, relativeTime } from "../lib/notifications";

// Corrections web 2026-09-24 (§4.1/§4.2) : cloche de l'en-tête pour tous les comptes connectés, à la
// place des onglets « Notifications » des différents espaces. Pastille = nombre de non lues (rien si
// tout est lu), panneau des dernières notifications, lien vers la page complète.
export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refreshCount = useCallback(() => { api<{ count: number }>("/notifications/unread-count").then(r => setUnread(r.count)).catch(() => {}); }, []);
  // Compteur relu au changement de page, toutes les 60 s tant que l'onglet est visible, et dès qu'une
  // notification est lue ailleurs (page complète).
  useEffect(() => { if (user) refreshCount(); }, [user, location.pathname, refreshCount]);
  useEffect(() => {
    if (!user) return;
    const tick = () => { if (document.visibilityState === "visible") refreshCount(); };
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener(NOTIFICATIONS_CHANGED, refreshCount);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); window.removeEventListener(NOTIFICATIONS_CHANGED, refreshCount); document.removeEventListener("visibilitychange", tick); };
  }, [user, refreshCount]);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    setItems(null);
    api<AppNotification[]>("/notifications?limit=8").then(setItems).catch(() => setItems([]));
    const onPointer = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!user) return null;
  const openNotification = async (n: AppNotification) => {
    if (!n.readAt) { await markNotificationRead(n.id); setUnread(c => Math.max(0, c - 1)); announceNotificationsChanged(); }
    setOpen(false);
    navigate(notificationHref(n, user.role));
  };
  const readAll = async () => {
    try { await markAllNotificationsRead(); setUnread(0); setItems(prev => prev?.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev); announceNotificationsChanged(); } catch { /* réessai possible */ }
  };
  const label = unread > 0 ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications";

  return <div className="bell" ref={rootRef}>
    <button ref={buttonRef} type="button" className="icon-button bell-button" aria-label={label} aria-expanded={open} aria-haspopup="true" aria-controls="bell-panel" onClick={() => setOpen(o => !o)} data-testid="notification-bell">
      <Bell size={22} aria-hidden="true" />
      {unread > 0 && <span className="bell-count" aria-hidden="true" data-testid="notification-count">{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <div id="bell-panel" className="bell-panel" role="dialog" aria-label="Dernières notifications">
      <div className="bell-head"><h2>Notifications</h2>{unread > 0 && <button type="button" className="link-button" onClick={readAll}>Tout marquer comme lu</button>}</div>
      {items === null
        ? <div className="bell-list" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 56, margin: "var(--s-2) var(--s-4)" }} />)}</div>
        : items.length === 0
          ? <p className="bell-empty">Aucune notification pour le moment.</p>
          : <ul className="bell-list">{items.map(n => <li key={n.id}>
            <button type="button" className={`bell-item${n.readAt ? "" : " unread"}`} onClick={() => openNotification(n)}>
              <span className="bell-dot" aria-hidden="true" />
              <span className="bell-copy"><b>{n.title}</b><span>{n.body}</span><small>{relativeTime(n.createdAt)}{n.readAt ? "" : " · non lue"}</small></span>
            </button>
          </li>)}</ul>}
      <Link className="bell-all" to="/notifications">Voir toutes les notifications</Link>
    </div>}
  </div>;
}
