import { ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Notice } from "./ui";

// Vérification du numéro par SMS, une seule fois (2026-09-24) : demandée avant la première inscription à
// une soirée, jamais à la connexion. Le numéro n'est visible ni des autres participants ni des restaurants.
export function PhoneVerification({ onVerified, compact = false }: { onVerified?: () => void; compact?: boolean }) {
  const { refresh } = useAuth();
  const [phone, setPhone] = useState(""), [code, setCode] = useState(""), [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [devCode, setDevCode] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (step === 1) { const r = await api<{ devCode?: string }>("/me/phone/request-code", { method: "POST", body: JSON.stringify({ phone }) }); setDevCode(r.devCode ?? null); setStep(2); }
      else { await api("/me/phone/verify", { method: "POST", body: JSON.stringify({ phone, code }) }); await refresh(); onVerified?.(); }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <form className={`phone-verification${compact ? " compact" : ""}`} onSubmit={submit} data-testid="phone-verification">
    <div className="phone-verification-head"><ShieldCheck size={20} aria-hidden="true" /><div><b>Confirmez votre numéro de téléphone</b><span>Une seule fois, par SMS, avant votre première réservation. Il n’est jamais montré aux autres participants ni aux restaurants.</span></div></div>
    {error && <Notice kind="error">{error}</Notice>}
    {step === 1
      ? <label>Numéro de téléphone<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+33612345678" autoComplete="tel" inputMode="tel" required /></label>
      : <label>Code reçu par SMS au {phone}<input className="otp-input" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" autoComplete="one-time-code" inputMode="numeric" required /></label>}
    <div className="decision-buttons">
      <button className="button small" disabled={busy}>{busy ? "Patientez…" : step === 1 ? "Recevoir le code" : "Confirmer mon numéro"}</button>
      {step === 2 && <button type="button" className="link-button" onClick={() => { setStep(1); setCode(""); }}>Modifier le numéro</button>}
    </div>
    {devCode && <p className="fine left">Mode local — aucun SMS envoyé. Code : {devCode}</p>}
  </form>;
}
