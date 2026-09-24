import { AlertTriangle } from "lucide-react";
import { Fragment, ReactNode } from "react";
import { useSeo } from "./lib/seo";
import mentionsMd from "./legal/mentions-legales.md?raw";
import cguMd from "./legal/cgu.md?raw";
import cgvMd from "./legal/cgv.md?raw";
import confidentialiteMd from "./legal/politique-confidentialite.md?raw";
import cookiesMd from "./legal/politique-cookies.md?raw";

// Documents juridiques (version du 23/09/2026). Le texte fait foi dans les fichiers ./legal/*.md :
// pour mettre à jour une page, on édite uniquement le Markdown correspondant. Les données de
// société non encore connues y figurent sous la forme « [À COMPLÉTER …] » / « [À DÉSIGNER …] » —
// jamais de valeur fictive présentée comme réelle. Tant qu'il en reste une, la page affiche
// automatiquement un bandeau d'avertissement.

// Rendu Markdown volontairement minimal, limité à ce qu'utilisent ces documents : titres (#, ##, ###),
// paragraphes, retours à la ligne forcés (deux espaces en fin de ligne), listes à puces et numérotées,
// tableaux, séparateurs (---) et gras (**…**). Construit des éléments React : aucun HTML injecté.

const inline = (text: string): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : part);

// Chaque ligne est enveloppée dans son propre fragment à clé : sans cela, les morceaux de deux lignes
// différentes partageaient les mêmes clés (avertissement React, contenu potentiellement omis).
const withBreaks = (lines: string[]): ReactNode[] =>
  lines.map((line, i) => <Fragment key={i}>{inline(line.replace(/ {2,}$/, ""))}{i < lines.length - 1 ? (/ {2,}$/.test(line) ? <br /> : " ") : null}</Fragment>);

const tableCells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());


function renderMarkdown(body: string): ReactNode[] {
  const lines = body.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const key = out.length;
    if (line.startsWith("### ")) { out.push(<h3 key={key}>{inline(line.slice(4))}</h3>); i++; continue; }
    if (line.startsWith("## ")) { out.push(<h2 key={key}>{inline(line.slice(3))}</h2>); i++; continue; }
    // Un « # » après le titre de la page marque une grande partie (ex. CGV : Partie A / Partie B).
    if (line.startsWith("# ")) { out.push(<h2 key={key} className="legal-part">{inline(line.slice(2))}</h2>); i++; continue; }
    if (/^-{3,}\s*$/.test(line)) { out.push(<hr key={key} />); i++; continue; }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const [head, , ...rest] = rows;
      out.push(<div key={key} className="table-scroll"><table>
        <thead><tr>{tableCells(head).map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
        <tbody>{rest.map((r, k) => <tr key={k}>{tableCells(r).map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    if (/^- /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]) : /^- /.test(lines[i]))) items.push(lines[i++].replace(/^(- |\d+\. )/, ""));
      const children = items.map((it, k) => <li key={k}>{inline(it)}</li>);
      out.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |- |\d+\. |\||-{3,}\s*$)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={key}>{withBreaks(para)}</p>);
  }
  return out;
}

const PLACEHOLDER = /\[À (COMPLÉTER|DÉSIGNER)[^\]]*\]/;

function LegalPage({ markdown }: { markdown: string }) {
  const [titleLine, ...body] = markdown.trim().split("\n");
  return (
    <div className="page legal-page">
      
      <h1>{titleLine.replace(/^# /, "")}</h1>
      {PLACEHOLDER.test(markdown) && (
        <div className="notice warning">
          <AlertTriangle size={18} aria-hidden="true"/><p><b>Document en cours de finalisation.</b> Certaines informations (signalées « À compléter ») seront renseignées prochainement.</p>
        </div>
      )}
      <div className="legal-body">{renderMarkdown(body.join("\n"))}</div>
    </div>
  );
}

const Titled = ({ title, path, markdown }: { title: string; path: string; markdown: string }) => { useSeo({ title, path, description: `${title} du service Nūr Meet.` }); return <LegalPage markdown={markdown} />; };
export const MentionsLegales = () => <Titled title="Mentions légales" path="/legal/mentions-legales" markdown={mentionsMd} />;
export const CGU = () => <Titled title="Conditions générales d’utilisation" path="/legal/cgu" markdown={cguMd} />;
export const CGV = () => <Titled title="Conditions générales de vente" path="/legal/cgv" markdown={cgvMd} />;
export const Confidentialite = () => <Titled title="Politique de confidentialité" path="/legal/confidentialite" markdown={confidentialiteMd} />;
export const Cookies = () => <Titled title="Politique cookies" path="/legal/cookies" markdown={cookiesMd} />;
