import { ReactNode } from "react";
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
    part.startsWith("**") && part.endsWith("**") ? <b key={i} style={{ color: "#fff" }}>{part.slice(2, -2)}</b> : part);

const withBreaks = (lines: string[]): ReactNode[] =>
  lines.flatMap((line, i) => {
    const content = inline(line.replace(/ {2,}$/, ""));
    return i < lines.length - 1 && / {2,}$/.test(line) ? [...content, <br key={`br${i}`} />] : i < lines.length - 1 ? [...content, " "] : content;
  });

const tableCells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());

const cellStyle = { border: "1px solid #333", padding: "8px 10px", textAlign: "left" as const, verticalAlign: "top" as const };

function renderMarkdown(body: string): ReactNode[] {
  const lines = body.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const key = out.length;
    if (line.startsWith("### ")) { out.push(<h3 key={key} style={{ margin: "8px 0 0" }}>{inline(line.slice(4))}</h3>); i++; continue; }
    if (line.startsWith("## ")) { out.push(<h2 key={key} style={{ margin: "18px 0 0" }}>{inline(line.slice(3))}</h2>); i++; continue; }
    // Un « # » après le titre de la page marque une grande partie (ex. CGV : Partie A / Partie B).
    if (line.startsWith("# ")) { out.push(<h2 key={key} className="eyebrow" style={{ margin: "30px 0 0", fontSize: 22 }}>{inline(line.slice(2))}</h2>); i++; continue; }
    if (/^-{3,}\s*$/.test(line)) { out.push(<hr key={key} style={{ border: 0, borderTop: "1px solid #333", margin: "10px 0" }} />); i++; continue; }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const [head, , ...rest] = rows;
      out.push(<div key={key} style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
        <thead><tr>{tableCells(head).map((c, j) => <th key={j} style={cellStyle}>{inline(c)}</th>)}</tr></thead>
        <tbody>{rest.map((r, k) => <tr key={k}>{tableCells(r).map((c, j) => <td key={j} style={cellStyle}>{inline(c)}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    if (/^- /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]) : /^- /.test(lines[i]))) items.push(lines[i++].replace(/^(- |\d+\. )/, ""));
      const children = items.map((it, k) => <li key={k}>{inline(it)}</li>);
      out.push(ordered ? <ol key={key} style={{ margin: 0, paddingLeft: 22 }}>{children}</ol> : <ul key={key} style={{ margin: 0, paddingLeft: 22 }}>{children}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |- |\d+\. |\||-{3,}\s*$)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={key} style={{ margin: 0 }}>{withBreaks(para)}</p>);
  }
  return out;
}

const PLACEHOLDER = /\[À (COMPLÉTER|DÉSIGNER)[^\]]*\]/;

function LegalPage({ markdown }: { markdown: string }) {
  const [titleLine, ...body] = markdown.trim().split("\n");
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <span className="eyebrow">DOCUMENT JURIDIQUE</span>
      <h1>{titleLine.replace(/^# /, "")}</h1>
      {PLACEHOLDER.test(markdown) && (
        <div className="notice error" style={{ marginBottom: 30 }}>
          <b>⚠️ Document en cours de finalisation.</b> Certaines informations (signalées « À compléter ») seront renseignées prochainement.
        </div>
      )}
      <div style={{ display: "grid", gap: 12, color: "#ccc", lineHeight: 1.7 }}>{renderMarkdown(body.join("\n"))}</div>
    </div>
  );
}

export const MentionsLegales = () => <LegalPage markdown={mentionsMd} />;
export const CGU = () => <LegalPage markdown={cguMd} />;
export const CGV = () => <LegalPage markdown={cgvMd} />;
export const Confidentialite = () => <LegalPage markdown={confidentialiteMd} />;
export const Cookies = () => <LegalPage markdown={cookiesMd} />;
