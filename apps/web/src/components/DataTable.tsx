import { ReactNode } from "react";

// Tableaux de l'administration (v3 : « tableaux plus lisibles ») : un vrai <table> sur grand écran (en-têtes
// de colonnes, lignes alignées), qui devient une pile de cartes étiquetées sur mobile — jamais un tableau
// à faire défiler horizontalement. Pendant le chargement, des lignes squelettes de même hauteur ; une
// liste vide affiche un message explicite, jamais un tableau vide sans explication.
export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  // Colonne numérique : alignée à droite, chiffres tabulaires.
  numeric?: boolean;
  // Colonne principale : pleine largeur et sans étiquette sur mobile.
  primary?: boolean;
};

export function DataTable<T>({ rows, columns, rowKey, empty, caption, onRowClick, selectedKey }: {
  rows: T[] | null;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty: ReactNode;
  caption?: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
}) {
  return <div className="data-table-wrap">
    <table className="data-table">
      {caption && <caption className="visually-hidden">{caption}</caption>}
      <thead><tr>{columns.map(c => <th key={c.key} scope="col" className={c.numeric ? "numeric" : undefined}>{c.header}</th>)}</tr></thead>
      <tbody>
        {rows === null
          ? [0, 1, 2, 3].map(i => <tr key={i} aria-hidden="true">{columns.map(c => <td key={c.key}><span className="skeleton skeleton-line"/></td>)}</tr>)
          : rows.length === 0
            ? <tr><td colSpan={columns.length} className="data-table-empty">{empty}</td></tr>
            : rows.map(row => {
              const key = rowKey(row);
              return <tr key={key} className={`${onRowClick ? "clickable" : ""}${selectedKey === key ? " selected" : ""}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map(c => <td key={c.key} data-label={c.header} className={`${c.numeric ? "numeric" : ""}${c.primary ? " primary" : ""}`}>{c.render(row)}</td>)}
              </tr>;
            })}
      </tbody>
    </table>
  </div>;
}

// Onglets de filtre avec compteur (« À valider · 3 ») : le nombre de lignes de chaque vue se lit sans cliquer.
export function FilterTabs<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: { value: V; label: string; count?: number }[]; label: string }) {
  return <div className="tabs filter-tabs" role="tablist" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? "active" : undefined} onClick={() => onChange(o.value)}>
      {o.label}{o.count != null && <span className="tab-count">{o.count}</span>}
    </button>)}
  </div>;
}
