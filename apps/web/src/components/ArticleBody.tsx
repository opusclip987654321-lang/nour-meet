import { ArticleChart, isAllowedInternalPath, parseArticleContent } from "@nour/shared";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Fragment, ReactNode } from "react";
import { Link } from "react-router-dom";
import { PHOTOS, Picture } from "./brand";

// Texte d'un paragraphe avec ses liens : un chemin interne autorisé devient un lien du site (sans
// rechargement), une URL https une source externe ouverte dans un nouvel onglet, tout le reste du
// texte brut — jamais un lien vers une route inexistante (§10 des corrections web 2026-09-24).
export const renderInline = (text: string): ReactNode[] => text.split(/(\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
  const match = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (!match) return <Fragment key={i}>{part}</Fragment>;
  const [, label, url] = match;
  if (url.startsWith("/")) return isAllowedInternalPath(url) ? <Link key={i} to={url}>{label}</Link> : <Fragment key={i}>{label}</Fragment>;
  if (/^https?:\/\//.test(url)) return <a key={i} href={url} target="_blank" rel="noopener noreferrer">{label}<ExternalLink size={13} aria-hidden="true" className="inline-icon" /><span className="visually-hidden"> (nouvel onglet)</span></a>;
  return <Fragment key={i}>{label}</Fragment>;
});

// Graphique d'un article : une seule série (le titre la nomme, pas de légende), barres horizontales
// fines à la couleur --chart-1, valeurs en texte d'encre, source toujours visible et données
// disponibles en tableau pour les lecteurs d'écran.
function ArticleBarChart({ chart }: { chart: ArticleChart }) {
  const max = Math.max(...chart.data.map(d => d.value), 0) || 1;
  const format = (v: number) => `${v.toLocaleString("fr-FR")}${chart.unit ? `\u202f${chart.unit}` : ""}`;
  return <figure className="article-chart">
    <figcaption>{chart.title}</figcaption>
    <div className="article-chart-rows" role="img" aria-label={`${chart.title} : ${chart.data.map(d => `${d.label} ${format(d.value)}`).join(", ")}`}>
      {chart.data.map(d => <div key={d.label} className="article-chart-row" title={`${d.label} : ${format(d.value)}`}>
        <span className="article-chart-label">{d.label}</span>
        <span className="article-chart-track"><i style={{ width: `${Math.max(0, (d.value / max) * 100)}%` }} /></span>
        <span className="article-chart-value">{format(d.value)}</span>
      </div>)}
    </div>
    <p className="article-chart-source">Source : <a href={chart.sourceUrl} target="_blank" rel="noopener noreferrer">{chart.sourceLabel}</a></p>
    <details className="chart-table"><summary>Voir les données</summary><div className="table-scroll"><table><thead><tr><th scope="col">Libellé</th><th scope="col">Valeur</th></tr></thead><tbody>{chart.data.map(d => <tr key={d.label}><td>{d.label}</td><td>{format(d.value)}</td></tr>)}</tbody></table></div></details>
  </figure>;
}

// Corps d'article du blog (§3.3) : intertitres, listes, images de la photothèque, graphiques sourcés,
// appels à l'action vers le site. Rend aussi à l'identique les anciens articles (paragraphes simples).
export function ArticleBody({ content }: { content: string }) {
  return <div className="article-body">{parseArticleContent(content).map((block, i) => {
    switch (block.type) {
      case "heading": return block.level === 2 ? <h2 key={i}>{block.text}</h2> : <h3 key={i}>{block.text}</h3>;
      case "paragraph": return <p key={i}>{renderInline(block.text)}</p>;
      case "list": return <ul key={i}>{block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}</ul>;
      case "quote": return <blockquote key={i}>{renderInline(block.text)}</blockquote>;
      case "image": return PHOTOS[block.photo] ? <figure key={i} className="article-figure"><Picture name={block.photo} alt={block.alt} sizes="(min-width: 800px) 720px, 100vw" /><figcaption>Photo d’illustration</figcaption></figure> : null;
      case "chart": return <ArticleBarChart key={i} chart={block.chart} />;
      case "cta": return isAllowedInternalPath(block.path) ? <p key={i} className="article-cta"><Link className="button" to={block.path}>{block.label}<ArrowRight size={18} aria-hidden="true" /></Link></p> : null;
    }
  })}</div>;
}

// Image de couverture : photothèque du site (« photo:nom ») ou fichier téléversé par l'administration.
export const articleCoverPhoto = (imageUrl: string | null | undefined) => imageUrl?.startsWith("photo:") ? imageUrl.slice(6) : null;
