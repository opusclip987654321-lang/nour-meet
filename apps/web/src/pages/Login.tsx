import { FormEvent, useEffect, useRef, useState } from "react";
import { Mail, Smartphone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api";
import { STAFF_ROLES, useAuth } from "../auth";
import { Layout } from "../components/Layout";
import { Notice } from "../components/ui";
import { useSeo } from "../lib/seo";

// Comptes de test créés par prisma/seed.ts (voir ce fichier pour le détail de chaque état) : ces
// boutons ne sont affichés que lorsque le serveur tourne en mode SMS simulé (jamais en production,
// même si quelqu'un forçait NODE_ENV=production avec SMS_MODE=mock, ce que env.ts refuse déjà).
const QUICK_LOGIN_GROUPS: {title:string; items:{label:string; phone:string}[]}[] = [
  { title: "Administration", items: [
    { label: "Administrateur (Walid)", phone: "+33600000001" },
    { label: "Modérateur", phone: "+33600000031" },
    { label: "Personnel d'accueil", phone: "+33600000030" },
  ] },
  { title: "Restaurateurs", items: [
    { label: "Restaurateur approuvé (Maison Amana)", phone: "+33600000002" },
    { label: "Restaurateur en attente d'approbation", phone: "+33600000010" },
  ] },
  { title: "Participants (comptes de test)", items: [
    { label: "Homme validé", phone: "+33600000020" },
    { label: "Homme non validé", phone: "+33600000021" },
    { label: "Femme validée", phone: "+33600000022" },
    { label: "Femme non validée", phone: "+33600000023" },
    { label: "Refusé (délai de 3 mois en cours)", phone: "+33600000024" },
    { label: "Entretien demandé, aucun créneau réservé", phone: "+33600000025" },
  ] },
  { title: "Parcours participants (données de test)", items: [
    { label: "Participation confirmée (soirée gratuite)", phone: "+33600000040" },
    { label: "Sur liste d’attente, soirées similaires proposées", phone: "+33600000041" },
    { label: "Paiement en attente", phone: "+33600000042" },
    { label: "Paiement effectué, participation confirmée", phone: "+33600000043" },
  ] },
  { title: "Comptes de démonstration réels", items: [
    { label: "Sofia (participante, historique complet)", phone: "+33612345678" },
    { label: "Karim (participant, historique complet)", phone: "+33687654321" },
  ] },
];

// Connexion (2026-09-24) : Google ou code par e-mail, sans SMS. Le SMS reste proposé pour les comptes
// créés avec un numéro ; ailleurs, il n'est demandé qu'une fois, avant la première réservation.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
type LoginResult = { token: string; isNewUser?: boolean; user: { role: string } };
type GoogleId = { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };

// Script Google chargé uniquement sur cette page, et seulement si la connexion Google est configurée.
function GoogleButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const render = () => {
      const google = (window as unknown as { google?: GoogleId }).google;
      if (!google || !ref.current) return;
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r: { credential: string }) => onCredential(r.credential), ux_mode: "popup" });
      google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: Math.min(ref.current.offsetWidth || 360, 400), locale: "fr" });
    };
    if ((window as unknown as { google?: GoogleId }).google) { render(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.onload = render; script.onerror = () => setFailed(true);
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rendu une seule fois
  }, []);
  if (!GOOGLE_CLIENT_ID) return null;
  return failed ? <p className="fine">Connexion Google momentanément indisponible : utilisez votre e-mail.</p> : <div ref={ref} className="google-button" data-testid="google-button" />;
}

export function Login() {
  useSeo({title:"Connexion",description:"Connectez-vous à Nūr Meet avec Google ou votre adresse e-mail.",path:"/login",noindex:true});
  const [method,setMethod]=useState<"email"|"sms">("email");
  const [identifier,setIdentifier]=useState(""),[code,setCode]=useState(""),[step,setStep]=useState<1|2|3>(1),[error,setError]=useState(""),[devCode,setDevCode]=useState<string|null>(null),[busy,setBusy]=useState(false); const {refresh}=useAuth(); const navigate=useNavigate();
  const [smsMode,setSmsMode]=useState<string|null>(null); const [quickLoginBusy,setQuickLoginBusy]=useState<string|null>(null);
  useEffect(()=>{api<{smsMode:string}>("/health").then(r=>setSmsMode(r.smsMode)).catch(()=>{})},[]);
  // isNewUser (renvoyé une seule fois, à la création du compte) déclenche l'écran de choix
  // participant/restaurateur (§5) avant toute navigation ; un compte déjà existant navigue tout de
  // suite comme avant, sans jamais revoir cet écran.
  const afterVerify=async(result:LoginResult)=>{
    setToken(result.token);await refresh();
    if(result.isNewUser){setStep(3);return}
    navigate(STAFF_ROLES.includes(result.user.role)?"/admin":"/dashboard");
  };
  const switchMethod=(m:"email"|"sms")=>{setMethod(m);setStep(1);setIdentifier("");setCode("");setError("");setDevCode(null)};
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setError("");setBusy(true);
    const base=method==="email"?"/auth/email":"/auth";
    const field=method==="email"?{email:identifier.trim()}:{phone:identifier};
    try{
      if(step===1){const result=await api<{devCode?:string}>(method==="email"?`${base}/request-code`:"/auth/request-otp",{method:"POST",body:JSON.stringify(field)});setDevCode(result.devCode??null);setStep(2)}
      else await afterVerify(await api<LoginResult>(method==="email"?`${base}/verify`:"/auth/verify-otp",{method:"POST",body:JSON.stringify({...field,code})}));
    }catch(err){setError((err as Error).message)}
    finally{setBusy(false)}
  };
  const google=async(credential:string)=>{setError("");try{await afterVerify(await api<LoginResult>("/auth/google",{method:"POST",body:JSON.stringify({credential})}))}catch(err){setError((err as Error).message)}};
  const quickLogin=async(label:string,quickPhone:string)=>{setError("");setQuickLoginBusy(label);try{await api("/auth/request-otp",{method:"POST",body:JSON.stringify({phone:quickPhone})});await afterVerify(await api<LoginResult>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone:quickPhone,code:"123456"})}))}catch(err){setError((err as Error).message)}finally{setQuickLoginBusy(null)}};
  const quickLoginNew=()=>quickLogin("Nouveau compte","+336"+Math.floor(10_000_000+Math.random()*89_999_999));
  const visual=<div className="auth-visual" style={{backgroundImage:"url(/images/paris-street-1600.webp)"}}><blockquote>Une belle rencontre commence par un cadre de confiance.</blockquote></div>;
  if(step===3)return <Layout><section className="auth-page">{visual}<div className="auth-form"><h1>Que souhaitez-vous faire sur Nūr Meet ?</h1><p>Ce choix détermine votre espace ; il ne peut être fait qu’une seule fois, à la création du compte.</p><div className="role-choice"><button type="button" className="button full" onClick={()=>navigate("/dashboard")}>Participer aux événements</button><button type="button" className="button secondary full" onClick={()=>navigate("/restaurant")}>Je suis restaurateur</button></div></div></section></Layout>;
  return <Layout><section className="auth-page">{visual}<form className="auth-form" onSubmit={submit}>
    <h1>{step===1?"Bienvenue sur Nūr Meet.":"Entrez le code reçu."}</h1>
    <p>{step===1?"Aucun mot de passe à mémoriser.":method==="email"?`Code envoyé à ${identifier}. Pensez à vérifier vos courriers indésirables.`:`Code envoyé au ${identifier}`}</p>
    {error&&<Notice kind="error">{error}</Notice>}
    {step===1&&method==="email"&&<><GoogleButton onCredential={google}/>{GOOGLE_CLIENT_ID&&<div className="auth-divider"><span>ou</span></div>}</>}
    {step===1
      ?method==="email"
        ?<label>Adresse e-mail<input type="email" value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="vous@exemple.fr" autoComplete="email" required/></label>
        :<label>Numéro de téléphone<input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="+33612345678" autoComplete="tel" inputMode="tel" required/></label>
      :<label>Code à six chiffres<input className="otp-input" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••••" autoComplete="one-time-code" inputMode="numeric" required/></label>}
    <button className="button full" disabled={busy}>{busy?"Patientez…":step===1?(method==="email"?"Recevoir mon code par e-mail":"Recevoir mon code par SMS"):"Vérifier le code"}</button>
    {step===2&&<button type="button" className="link-button" onClick={()=>{setStep(1);setCode("")}}>Modifier {method==="email"?"l’adresse":"le numéro"}</button>}
    {step===1&&(method==="email"
      ?<button type="button" className="link-button" onClick={()=>switchMethod("sms")}><Smartphone size={16} aria-hidden="true"/>Compte créé avec un numéro de téléphone ? Connexion par SMS</button>
      :<button type="button" className="link-button" onClick={()=>switchMethod("email")}><Mail size={16} aria-hidden="true"/>Se connecter avec Google ou par e-mail</button>)}
    {devCode&&<div className="demo-box"><b>Mode local — aucun {method==="email"?"e-mail":"SMS"} réellement envoyé</b><span>Code de développement : {devCode}</span></div>}
    {smsMode==="mock"&&<div className="quick-login"><b>Mode local — connexion rapide (jamais en production)</b>{QUICK_LOGIN_GROUPS.map(group=><div key={group.title}><small>{group.title}</small><div className="quick-login-grid">{group.items.map(item=><button type="button" key={item.phone} disabled={!!quickLoginBusy} onClick={()=>quickLogin(item.label,item.phone)}>{quickLoginBusy===item.label?"…":item.label}</button>)}</div></div>)}<div><small>Autre</small><div className="quick-login-grid"><button type="button" disabled={!!quickLoginBusy} onClick={quickLoginNew}>{quickLoginBusy==="Nouveau compte"?"…":"Nouveau compte (jamais inscrit)"}</button></div></div></div>}
  </form></section></Layout>;
}
