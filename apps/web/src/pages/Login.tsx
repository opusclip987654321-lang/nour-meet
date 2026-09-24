import { FormEvent, useEffect, useState } from "react";
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

export function Login() {
  useSeo({title:"Connexion",description:"Connectez-vous à Nūr Meet avec votre numéro de téléphone.",path:"/login",noindex:true});
  const [phone,setPhone]=useState(""),[code,setCode]=useState(""),[step,setStep]=useState<1|2|3>(1),[error,setError]=useState(""),[devCode,setDevCode]=useState<string|null>(null); const {refresh}=useAuth(); const navigate=useNavigate();
  const [smsMode,setSmsMode]=useState<string|null>(null); const [quickLoginBusy,setQuickLoginBusy]=useState<string|null>(null);
  useEffect(()=>{api<{smsMode:string}>("/health").then(r=>setSmsMode(r.smsMode)).catch(()=>{})},[]);
  // isNewUser (renvoyé une seule fois, à la création du compte) déclenche l'écran de choix
  // participant/restaurateur (§5) avant toute navigation ; un compte déjà existant navigue tout de
  // suite comme avant, sans jamais revoir cet écran.
  const afterVerify=async(result:{token:string;isNewUser?:boolean;user:{role:string}})=>{
    setToken(result.token);await refresh();
    if(result.isNewUser){setStep(3);return}
    navigate(STAFF_ROLES.includes(result.user.role)?"/admin":"/dashboard");
  };
  const submit=async(e:FormEvent)=>{e.preventDefault();setError("");try{if(step===1){const result=await api<{delivery:"mock"|"sms";devCode?:string}>("/auth/request-otp",{method:"POST",body:JSON.stringify({phone})});setDevCode(result.devCode??null);setStep(2)}else{await afterVerify(await api<{token:string;isNewUser?:boolean;user:{role:string}}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone,code})}))}}catch(err){setError((err as Error).message)}};
  const quickLogin=async(label:string,quickPhone:string)=>{setError("");setQuickLoginBusy(label);try{await api("/auth/request-otp",{method:"POST",body:JSON.stringify({phone:quickPhone})});await afterVerify(await api<{token:string;isNewUser?:boolean;user:{role:string}}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone:quickPhone,code:"123456"})}))}catch(err){setError((err as Error).message)}finally{setQuickLoginBusy(null)}};
  const quickLoginNew=()=>quickLogin("Nouveau compte","+336"+Math.floor(10_000_000+Math.random()*89_999_999));
  if(step===3)return <Layout><section className="auth-page"><div className="auth-visual" style={{backgroundImage:"url(/images/paris-street-1600.webp)"}}><blockquote>Une belle rencontre commence par un cadre de confiance.</blockquote></div><div className="auth-form"><h1>Que souhaitez-vous faire sur Nūr Meet ?</h1><p>Ce choix détermine votre espace ; il ne peut être fait qu’une seule fois, à la création du compte.</p><div className="role-choice"><button type="button" className="button full" onClick={()=>navigate("/dashboard")}>Participer aux événements</button><button type="button" className="button secondary full" onClick={()=>navigate("/restaurant")}>Je suis restaurateur</button></div></div></section></Layout>;
  return <Layout><section className="auth-page"><div className="auth-visual" style={{backgroundImage:"url(/images/paris-street-1600.webp)"}}><blockquote>Une belle rencontre commence par un cadre de confiance.</blockquote></div><form className="auth-form" onSubmit={submit}><h1>{step===1?"Votre numéro ouvre la porte.":"Entrez le code reçu."}</h1><p>{step===1?"Aucun mot de passe à mémoriser.":`Code envoyé au ${phone}`}</p>{error&&<Notice kind="error">{error}</Notice>}{step===1?<label>Numéro de téléphone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+33612345678" autoComplete="tel" inputMode="tel" required/></label>:<label>Code à six chiffres<input className="otp-input" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••••" autoComplete="one-time-code" inputMode="numeric" required/></label>}<button className="button full">{step===1?"Recevoir mon code":"Vérifier le code"}</button>{devCode&&<div className="demo-box"><b>Mode local — aucun SMS facturé</b><span>Code de développement : {devCode}</span></div>}{smsMode==="mock"&&<div className="quick-login"><b>Mode local — connexion rapide (jamais en production)</b>{QUICK_LOGIN_GROUPS.map(group=><div key={group.title}><small>{group.title}</small><div className="quick-login-grid">{group.items.map(item=><button type="button" key={item.phone} disabled={!!quickLoginBusy} onClick={()=>quickLogin(item.label,item.phone)}>{quickLoginBusy===item.label?"…":item.label}</button>)}</div></div>)}<div><small>Autre</small><div className="quick-login-grid"><button type="button" disabled={!!quickLoginBusy} onClick={quickLoginNew}>{quickLoginBusy==="Nouveau compte"?"…":"Nouveau compte (jamais inscrit)"}</button></div></div></div>}</form></section></Layout>;
}
