import { useEffect } from "react";

// Référencement (corrections web 2026-09-24, §19/§20) : chaque page importante pose ses propres
// balises (titre, description, canonique, Open Graph, Twitter, robots) et ses données structurées,
// strictement fidèles au contenu affiché. Les valeurs par défaut restent celles de index.html.
export const SITE_NAME = "Nūr Meet";
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
export const DEFAULT_DESCRIPTION = "Speed dating et soirées networking en petit comité dans des restaurants partenaires à Paris et en Île-de-France. Profils vérifiés, contact uniquement si l’intérêt est réciproque.";
export const DEFAULT_IMAGE = "/images/paris-terrace-1600.webp";
export const absoluteUrl = (path: string) => /^https?:\/\//.test(path) ? path : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

type Seo = {
  title: string;
  description?: string;
  path?: string;
  image?: string | null;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: object | object[] | null;
};

const setMeta = (attr: "name" | "property", key: string, content: string | null) => {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content == null) { el?.remove(); return; }
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute("content", content);
};
const setCanonical = (href: string | null) => {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) { el?.remove(); return; }
  if (!el) { el = document.createElement("link"); el.rel = "canonical"; document.head.appendChild(el); }
  el.href = href;
};

export const pageTitle = (title: string) => title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;

export function useSeo(seo: Seo | null) {
  const key = seo ? JSON.stringify(seo) : null;
  useEffect(() => {
    if (!seo) return;
    const title = pageTitle(seo.title);
    const description = seo.description || DEFAULT_DESCRIPTION;
    const url = seo.path ? absoluteUrl(seo.path) : null;
    const image = absoluteUrl(seo.image || DEFAULT_IMAGE);
    document.title = title;
    setMeta("name", "description", description);
    setMeta("name", "robots", seo.noindex ? "noindex, nofollow" : null);
    setCanonical(seo.noindex ? null : url);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", seo.type ?? "website");
    setMeta("property", "og:url", url);
    setMeta("property", "og:image", image);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", image);
    const scripts = (seo.jsonLd ? (Array.isArray(seo.jsonLd) ? seo.jsonLd : [seo.jsonLd]) : []).map(data => {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.seo = "page";
      script.text = JSON.stringify(data);
      document.head.appendChild(script);
      return script;
    });
    return () => { scripts.forEach(s => s.remove()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la clé sérialisée couvre tout l'objet
  }, [key]);
}

export const breadcrumbJsonLd = (items: { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: absoluteUrl(item.path) }))
});
