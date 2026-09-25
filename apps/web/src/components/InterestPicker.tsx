import { INTEREST_GROUPS, MAX_INTERESTS, foldText } from "@nour/shared";
import { Plus, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

// Centres d'intérêt (décision v2 §1.3) : choix dans la liste commune, recherche instantanée, sans
// saisie libre ; un centre choisi quitte les propositions et reste visible en pastille retirable.
export function InterestPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const full = value.length >= MAX_INTERESTS;
  const groups = useMemo(() => {
    const q = foldText(query.trim());
    return INTEREST_GROUPS
      .map(g => ({ theme: g.theme, items: g.items.filter(i => !value.includes(i) && (!q || foldText(i).includes(q))) }))
      .filter(g => g.items.length > 0);
  }, [query, value]);
  return <div className="interest-picker">
    <div className="interest-head"><label htmlFor={inputId}>Centres d’intérêt</label><span>{value.length}/{MAX_INTERESTS}</span></div>
    {value.length > 0 && <ul className="interest-selected" aria-label="Centres d’intérêt choisis">{value.map(i => <li key={i}><button type="button" className="chip active" onClick={() => onChange(value.filter(v => v !== i))} aria-label={`Retirer ${i}`}>{i}<X size={14} aria-hidden="true" /></button></li>)}</ul>}
    <div className="search-field"><Search size={18} aria-hidden="true" /><input id={inputId} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher : cinéma, randonnée, entrepreneuriat…" disabled={full} /></div>
    {full
      ? <p className="fine left">Vous avez choisi {MAX_INTERESTS} centres d’intérêt, le maximum. Retirez-en un pour en ajouter un autre.</p>
      : <div className="interest-options">{groups.length === 0
        ? <p className="fine left">Aucun centre d’intérêt ne correspond à « {query} ».</p>
        : groups.map(g => <div key={g.theme} className="interest-group"><small>{g.theme}</small><div className="interest-chips">{g.items.map(i => <button key={i} type="button" className="chip" onClick={() => { onChange([...value, i]); setQuery(""); }}><Plus size={14} aria-hidden="true" />{i}</button>)}</div></div>)}</div>}
  </div>;
}
