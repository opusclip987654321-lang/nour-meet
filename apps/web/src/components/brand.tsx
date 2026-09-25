import { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";

// Identité : la barre du « ū » de Nūr (« lumière ») est le signe de la marque — un trait safran
// posé au-dessus du u. Le monogramme reprend ce seul « ū » ; il sert de favicon
// (public/favicon.svg, mêmes tracés) et d'icône d'application.
export function BrandMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="32" height="32" rx="8" fill="var(--night, #1c2653)" />
      <rect x="9" y="7.5" width="14" height="3.2" rx="1.6" fill="var(--saffron, #f2a33a)" />
      <path d="M10.2 14.2v5.6a5.8 5.8 0 0 0 11.6 0v-5.6" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark${className ? ` ${className}` : ""}`} aria-hidden="true">
      n<span className="wordmark-u">u</span>r<span className="wordmark-meet">meet</span>
    </span>
  );
}

export function Logo({ onNight = false, to = "/" }: { onNight?: boolean; to?: string }) {
  return (
    <Link className={`logo${onNight ? " on-night" : ""}`} to={to} aria-label="Nūr Meet — accueil">
      <BrandMark size={32} />
      <Wordmark />
    </Link>
  );
}

// Photo responsive : AVIF puis WebP, trois largeurs, dimensions déclarées pour réserver la place
// (aucun décalage de mise en page au chargement), chargement différé sauf image prioritaire.
// Les fichiers vivent dans public/images/<nom>-<largeur>.<format> (voir CREDITS.md).
// `ai` : illustration générée par IA (OpenAI Images, contrôlée selon la charte avant publication) —
// toujours accompagnée de la mention visible « Illustration générée par IA ».
export const PHOTOS: Record<string, { w: number; h: number; alt: string; ai?: boolean }> = {
  "ai-soiree": { w: 1024, h: 1536, alt: "Six convives autour d'une grande table dans un restaurant parisien, en pleine conversation", ai: true },
  "ai-tete-a-tete": { w: 1536, h: 1024, alt: "Un homme et une femme en tête-à-tête à une petite table de bistrot, autour de deux thés à la menthe", ai: true },
  "ai-networking": { w: 1536, h: 1024, alt: "Des professionnels échangent leurs cartes lors d'une soirée networking dans un restaurant", ai: true },
  "ai-entretien": { w: 1536, h: 1024, alt: "Une jeune femme souriante au téléphone chez elle, près d'une fenêtre parisienne", ai: true },
  "ai-echange-code": { w: 1536, h: 1024, alt: "À table, une participante scanne avec son téléphone le code affiché sur le téléphone d'un participant", ai: true },
  "ai-apres-soiree": { w: 1536, h: 1024, alt: "Le lendemain, un homme sourit en lisant un message sur son téléphone à une terrasse de café", ai: true },
  "friends-duo": { w: 1600, h: 1067, alt: "Deux amies souriantes dans un parc" },
  "portrait-woman": { w: 1600, h: 2400, alt: "Une jeune femme dans une rue de Paris" },
  "portrait-man": { w: 1600, h: 2000, alt: "Portrait d'un homme souriant" },
  "networking-pro": { w: 1600, h: 2400, alt: "Un homme en costume dans un jardin parisien" },
  "networking-event": { w: 1600, h: 1067, alt: "Des personnes qui échangent lors d'une soirée professionnelle" },
  "shared-table": { w: 1600, h: 1200, alt: "Une table garnie de plats à partager" },
  "meal-overhead": { w: 1600, h: 2133, alt: "Un repas partagé vu du dessus" },
  "tea-hands": { w: 1600, h: 2399, alt: "Des verres de thé servis autour d'une table" },
  "paris-terrace": { w: 1600, h: 1067, alt: "Une terrasse de café parisien animée" },
  "paris-street": { w: 1600, h: 1066, alt: "Une rue de Paris bordée de terrasses" },
  "bistro-front": { w: 1600, h: 2889, alt: "La devanture d'un bistrot parisien" },
  "venue-day": { w: 1600, h: 2400, alt: "La salle d'un restaurant en journée" },
  "venue-evening": { w: 1600, h: 1067, alt: "Un restaurant chaleureux en soirée" }
};

export function Picture({ name, sizes = "100vw", priority = false, className, style, alt }: { name: keyof typeof PHOTOS | string; sizes?: string; priority?: boolean; className?: string; style?: CSSProperties; alt?: string }) {
  const photo = PHOTOS[name];
  if (!photo) return null;
  const set = (fmt: string) => [640, 1024, 1600].map(w => `/images/${name}-${w}.${fmt} ${w}w`).join(", ");
  const picture = (
    <picture className={photo.ai ? undefined : className} style={photo.ai ? undefined : style}>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={set("webp")} sizes={sizes} />
      <img src={`/images/${name}-1024.webp`} width={photo.w} height={photo.h} alt={alt ?? photo.alt} loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"} />
    </picture>
  );
  if (!photo.ai) return picture;
  return <span className={`ai-picture${className ? ` ${className}` : ""}`} style={style}>{picture}<span className="ai-image-tag">Illustration générée par IA</span></span>;
}

// Flou progressif porté du composant « Progressive Blur » de Magic UI (licence MIT,
// github.com/magicuidesign/magicui, registry/magicui/progressive-blur.tsx). Réécrit sans Tailwind
// ni utilitaire `cn` : couches de backdrop-filter de plus en plus fortes, chacune masquée sur une
// bande du dégradé. Sert à rendre un texte lisible par-dessus une photo sans l'assombrir en bloc.
export function ProgressiveBlur({ position = "bottom", height = "50%", blurLevels = [0.5, 1, 2, 4, 8, 16] }: { position?: "top" | "bottom"; height?: string; blurLevels?: number[] }) {
  const dir = position === "bottom" ? "to bottom" : "to top";
  const step = 100 / (blurLevels.length + 1);
  return (
    <div className="progressive-blur" aria-hidden="true" style={{ position: "absolute", insetInline: 0, [position]: 0, height, pointerEvents: "none", zIndex: 1 }}>
      {blurLevels.map((blur, i) => {
        const start = i * step, mid = (i + 1) * step, end = (i + 2) * step;
        const mask = `linear-gradient(${dir}, transparent ${start}%, #000 ${mid}%, #000 ${end}%, transparent ${Math.min(end + step, 100)}%)`;
        return <div key={i} style={{ position: "absolute", inset: 0, backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)`, maskImage: mask, WebkitMaskImage: mask }} />;
      })}
    </div>
  );
}

export function Section({ id, className, children, labelledBy }: { id?: string; className?: string; children: ReactNode; labelledBy?: string }) {
  return <section id={id} className={`section${className ? ` ${className}` : ""}`} aria-labelledby={labelledBy}>{children}</section>;
}
