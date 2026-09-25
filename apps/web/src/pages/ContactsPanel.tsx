import { ArrowLeft, Check, MessageCircle, Search, Send, UserPlus, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Avatar, Notice } from "../components/ui";

// Mise en relation après une soirée (§ concept) : chaque participant a un code personnel ; saisir
// le code de quelqu'un permet de voir son profil et de lui envoyer une demande. La conversation ne
// s'ouvre que si la demande est acceptée — l'API refuse toute relance après un refus.
type Person = { id: string; displayName: string; profile?: { photoUrl?: string | null } | null };
type ContactRequest = { id: string; status: "PENDING" | "ACCEPTED" | "REFUSED" | "CANCELLED"; requesterId: string; recipientId: string; requester: Person; recipient: Person; createdAt: string };
type Conversation = { id: string; members: { userId: string; blockedAt: string | null; user: Person }[]; messages: { body?: string | null; createdAt: string }[] };

const STATUS_LABEL: Record<ContactRequest["status"], string> = { PENDING: "En attente de réponse", ACCEPTED: "Acceptée", REFUSED: "Déclinée", CANCELLED: "Annulée" };
const time = (v: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v)).replace(":", "h");

function MyCode() {
  const [qr, setQr] = useState<{ code: string; qrDataUrl: string } | null>(null);
  useEffect(() => { api<{ code: string; qrDataUrl: string }>("/me/share-qr").then(setQr).catch(() => {}); }, []);
  return <section className="panel contact-code" aria-labelledby="my-code">
    <div className="panel-title"><h2 id="my-code">Mon code personnel</h2></div>
    <div className="contact-code-body">
      {qr ? <img src={qr.qrDataUrl} alt={`QR code de votre code personnel ${qr.code}`} width={152} height={152}/> : <div className="skeleton" style={{ width: 152, height: 152 }}/>}
      <div>
        <ol className="interview-steps"><li><b>1.</b> Montrez ce QR code ou dictez votre code</li><li><b>2.</b> La personne le scanne (application) ou le saisit (site)</li><li><b>3.</b> Vous recevez sa demande : rien ne s’ouvre sans votre accord</li></ol>
        {qr && <strong className="contact-code-value">{qr.code}</strong>}
      </div>
    </div>
  </section>;
}

function AddContact({ onSent }: { onSent: () => void }) {
  const [code, setCode] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = async (e: FormEvent) => {
    e.preventDefault(); setNotice(null); setProfile(null);
    if (!code.trim()) return;
    setBusy(true);
    try { setProfile(await api(`/profiles/code/${encodeURIComponent(code.trim())}`)); }
    catch (err) { setNotice({ kind: "error", text: (err as Error).message }); }
    finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setNotice(null);
    try { await api("/contacts/request", { method: "POST", body: JSON.stringify({ recipientId: profile.userId }) }); setNotice({ kind: "success", text: `Demande envoyée à ${profile.displayName}. La conversation s’ouvrira si elle est acceptée.` }); setProfile(null); setCode(""); onSent(); }
    catch (err) { setNotice({ kind: "error", text: (err as Error).message }); }
    finally { setBusy(false); }
  };
  return <section className="panel" aria-labelledby="add-contact">
    <div className="panel-title"><h2 id="add-contact">Revoir quelqu’un</h2></div>
    <form className="contact-lookup" onSubmit={lookup}>
      <label>Code personnel de la personne<input value={code} onChange={e => setCode(e.target.value)} placeholder="Ex. NOUR-3F9A-C21B-07E4" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"/></label>
      <button className="button secondary" disabled={busy || !code.trim()}><Search size={18} aria-hidden="true"/>Rechercher</button>
    </form>
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    {profile && <div className="contact-preview">
      <Avatar name={profile.displayName} photoUrl={profile.photoUrl} size="large" verified={profile.validated}/>
      <div>
        <h3>{profile.displayName}</h3>
        <p className="contact-meta">{[profile.age ? `${profile.age} ans` : null, profile.city, profile.profession].filter(Boolean).join(" · ")}</p>
        {profile.bio && <p>{profile.bio}</p>}
        {profile.interests?.length > 0 && <div className="chips">{profile.interests.map((i: string) => <span key={i}>{i}</span>)}</div>}
        <button type="button" className="button" disabled={busy} onClick={send}><UserPlus size={18} aria-hidden="true"/>Envoyer une demande de contact</button>
      </div>
    </div>}
  </section>;
}

function Requests({ requests, onChanged, onOpenChat }: { requests: ContactRequest[] | null; onChanged: () => void; onOpenChat: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const respond = async (id: string, accept: boolean) => {
    setBusy(id); setError("");
    try { await api(`/contacts/${id}/respond`, { method: "POST", body: JSON.stringify({ accept }) }); onChanged(); if (accept) onOpenChat(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  };
  if (requests === null) return <div className="skeleton" style={{ height: 88 }}/>;
  const incoming = requests.filter(r => r.recipientId === user?.id && r.status === "PENDING");
  const sent = requests.filter(r => r.requesterId === user?.id);
  if (incoming.length === 0 && sent.length === 0) return null;
  return <section className="panel" aria-labelledby="requests">
    <div className="panel-title"><h2 id="requests">Demandes de contact</h2></div>
    {error && <Notice kind="error">{error}</Notice>}
    {incoming.length > 0 && <ul className="contact-list">{incoming.map(r => <li key={r.id}>
      <Avatar name={r.requester.displayName} photoUrl={r.requester.profile?.photoUrl}/>
      <div><b>{r.requester.displayName}</b><span>souhaite rester en contact · {time(r.createdAt)}</span></div>
      <div className="contact-actions">
        <button type="button" className="button small" disabled={busy === r.id} onClick={() => respond(r.id, true)}><Check size={16} aria-hidden="true"/>Accepter</button>
        <button type="button" className="button small secondary" disabled={busy === r.id} onClick={() => respond(r.id, false)}><X size={16} aria-hidden="true"/>Décliner</button>
      </div>
    </li>)}</ul>}
    {sent.length > 0 && <>
      <h3 className="contact-subtitle">Envoyées</h3>
      <ul className="contact-list">{sent.map(r => <li key={r.id}>
        <Avatar name={r.recipient.displayName} photoUrl={r.recipient.profile?.photoUrl}/>
        <div><b>{r.recipient.displayName}</b><span>{STATUS_LABEL[r.status]} · {time(r.createdAt)}</span></div>
      </li>)}</ul>
    </>}
  </section>;
}

function Messages({ conversations }: { conversations: Conversation[] | null }) {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const active = conversations?.find(c => c.id === activeId) ?? null;
  const other = (c: Conversation) => c.members.find(m => m.userId !== user?.id);
  const blocked = !!active?.members.find(m => m.userId === user?.id)?.blockedAt;
  const loadMessages = useCallback((id: string) => api<any[]>(`/conversations/${id}/messages`).then(setMessages).catch(() => {}), []);
  // Rafraîchissement léger toutes les 10 s tant qu'une conversation est ouverte (pas de temps réel côté API).
  useEffect(() => {
    if (!activeId) return;
    setMessages(null); loadMessages(activeId);
    const t = setInterval(() => loadMessages(activeId), 10_000);
    return () => clearInterval(t);
  }, [activeId, loadMessages]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages?.length]);
  const send = async (e: FormEvent) => {
    e.preventDefault(); if (!body.trim() || !activeId) return; setError("");
    try { const m = await api<any>(`/conversations/${activeId}/messages`, { method: "POST", body: JSON.stringify({ body: body.trim() }) }); setMessages(list => [...(list ?? []), m]); setBody(""); }
    catch (err) { setError((err as Error).message); }
  };
  if (conversations === null) return <div className="skeleton" style={{ height: 120 }}/>;
  if (conversations.length === 0) return <section className="panel empty small"><MessageCircle size={24} aria-hidden="true"/><h2>Aucune conversation pour le moment</h2><p>Une conversation s’ouvre dès qu’une demande de contact est acceptée.</p></section>;
  return <section className="messages" aria-label="Messagerie">
    <aside className={active ? "messages-list has-active" : "messages-list"} aria-label="Conversations">
      {conversations.map(c => { const o = other(c); return <button type="button" key={c.id} className={c.id === activeId ? "active" : undefined} aria-current={c.id === activeId ? "true" : undefined} onClick={() => setActiveId(c.id)}>
        <Avatar name={o?.user.displayName} photoUrl={o?.user.profile?.photoUrl}/>
        <div><b>{o?.user.displayName ?? "Participant"}</b><span>{c.messages[0]?.body ?? "Nouvelle conversation"}</span></div>
      </button>; })}
    </aside>
    <section className={active ? "chat has-active" : "chat"}>
      {!active ? <div className="chat-empty"><MessageCircle size={24} aria-hidden="true"/><p>Choisissez une conversation.</p></div> : <>
        <div className="chat-head">
          <button type="button" className="icon-button chat-back" onClick={() => setActiveId(null)} aria-label="Retour aux conversations"><ArrowLeft size={20} aria-hidden="true"/></button>
          <Avatar name={other(active)?.user.displayName} photoUrl={other(active)?.user.profile?.photoUrl}/>
          <b>{other(active)?.user.displayName}</b>
        </div>
        <div className="chat-body" aria-live="polite">
          {messages === null ? <div className="spinner small"/> : messages.length === 0 ? <p className="fine">Dites bonjour : c’est le début de votre conversation.</p> : messages.map(m => <div key={m.id} className={`bubble${m.senderId === user?.id ? " mine" : ""}`}><span>{m.body}</span><small>{time(m.createdAt)}</small></div>)}
          <div ref={endRef}/>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {blocked ? <p className="chat-closed">Cette conversation est fermée.</p> : <form className="chat-input" onSubmit={send}>
          <label className="visually-hidden" htmlFor="chat-message">Votre message</label>
          <input id="chat-message" value={body} onChange={e => setBody(e.target.value)} maxLength={2000} placeholder="Écrire un message…" autoComplete="off"/>
          <button disabled={!body.trim()} aria-label="Envoyer"><Send size={18} aria-hidden="true"/></button>
        </form>}
      </>}
    </section>
  </section>;
}

export function ContactsPanel() {
  const [requests, setRequests] = useState<ContactRequest[] | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const load = useCallback(() => {
    api<ContactRequest[]>("/me/contact-requests").then(setRequests).catch(() => setRequests([]));
    api<Conversation[]>("/conversations").then(setConversations).catch(() => setConversations([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  return <div className="stack contacts">
    <Requests requests={requests} onChanged={load} onOpenChat={load}/>
    <Messages conversations={conversations}/>
    <div className="contacts-grid"><AddContact onSent={load}/><MyCode/></div>
  </div>;
}
