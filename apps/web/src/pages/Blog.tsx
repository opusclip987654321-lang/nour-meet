import { ArrowLeft, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { ArticleBody, articleCoverPhoto } from "../components/ArticleBody";
import { Layout } from "../components/Layout";
import { Picture } from "../components/brand";
import { imgUrl } from "../lib/format";
import { BLOG_CATEGORIES } from "../lib/labels";
import { SITE_NAME, absoluteUrl, breadcrumbJsonLd, useSeo } from "../lib/seo";
import { NotFound } from "./NotFound";

const publishedDate = (value: string) => new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function ArticleCover({ imageUrl, priority = false, sizes }: { imageUrl: string | null; priority?: boolean; sizes: string }) {
  const photo = articleCoverPhoto(imageUrl);
  if (photo) return <Picture name={photo} priority={priority} sizes={sizes} alt="" />;
  if (imageUrl) return <img src={imgUrl(imageUrl)} alt="" loading={priority ? "eager" : "lazy"} decoding="async" width={1200} height={800} />;
  return null;
}
const coverAbsoluteUrl = (imageUrl: string | null) => {
  const photo = articleCoverPhoto(imageUrl);
  return photo ? absoluteUrl(`/images/${photo}-1600.webp`) : imageUrl ? imgUrl(imageUrl) : null;
};

export function Blog() {
  const [articles, setArticles] = useState<any[] | null>(null);
  const [category, setCategory] = useState("");
  useEffect(() => {
    let ignore = false;
    setArticles(null);
    api<any[]>(`/articles${category ? `?category=${encodeURIComponent(category)}` : ""}`).then(a => { if (!ignore) setArticles(a); }).catch(() => { if (!ignore) setArticles([]); });
    return () => { ignore = true; };
  }, [category]);
  useSeo({ title: "Le journal : rencontres, amitié et vie sociale", description: "Conseils, repères et études pour faire de vraies rencontres, élargir son cercle d’amis et développer son réseau professionnel à Paris.", path: "/blog" });
  return <Layout><section className="page">
    <h1>Rencontres, amitié et vie sociale</h1>
    <p className="page-lead">Des repères concrets et des études sourcées pour rencontrer, se faire des amis et développer son réseau.</p>
    <div className="filters"><label><span className="visually-hidden">Filtrer par thème</span><select value={category} onChange={e => setCategory(e.target.value)}><option value="">Tous les thèmes</option>{BLOG_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></label></div>
    {articles === null
      ? <div className="event-grid" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="event-card skeleton-card"><div className="skeleton" style={{ aspectRatio: "4 / 3" }} /><div className="event-copy"><div className="skeleton" style={{ height: 18, width: "40%" }} /><div className="skeleton" style={{ height: 26, width: "85%" }} /></div></div>)}</div>
      : articles.length === 0
        ? <div className="empty"><Inbox size={24} aria-hidden="true" /><h2>Aucun article pour le moment</h2></div>
        : <div className="event-grid">{articles.map((a, i) => <article key={a.id} className="event-card">
          <div className="event-art"><ArticleCover imageUrl={a.imageUrl} priority={i < 3} sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw" />{a.imageAiGenerated && <span className="ai-image-tag">Illustration générée par IA</span>}</div>
          <div className="event-copy">
            <p className="event-date">{a.category}{a.publishedAt && <> · {publishedDate(a.publishedAt)}</>}</p>
            <h2 className="event-title"><Link to={`/blog/${a.slug}`} className="stretched">{a.title}</Link></h2>
            {a.excerpt && <p className="article-excerpt">{a.excerpt}</p>}
          </div>
        </article>)}</div>}
  </section></Layout>;
}

export function ArticlePage() {
  const { id } = useParams();
  const [article, setArticle] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => { setArticle(null); setNotFound(false); api<any>(`/articles/${id}`).then(setArticle).catch(() => setNotFound(true)); }, [id]);
  // Données structurées BlogPosting + fil d'Ariane : uniquement les champs réellement affichés.
  useSeo(article ? {
    title: article.metaTitle || article.title,
    description: article.metaDescription || article.excerpt || undefined,
    path: `/blog/${article.slug}`,
    image: coverAbsoluteUrl(article.imageUrl),
    type: "article",
    jsonLd: [
      {
        "@context": "https://schema.org", "@type": "BlogPosting",
        headline: article.title, description: article.excerpt ?? undefined,
        image: coverAbsoluteUrl(article.imageUrl) ?? undefined,
        datePublished: article.publishedAt ?? undefined, dateModified: article.updatedAt ?? article.publishedAt ?? undefined,
        author: article.author ? { "@type": "Person", name: article.author.displayName } : { "@type": "Organization", name: SITE_NAME },
        publisher: { "@type": "Organization", name: SITE_NAME, logo: { "@type": "ImageObject", url: absoluteUrl("/icon-512.png") } },
        mainEntityOfPage: absoluteUrl(`/blog/${article.slug}`),
        articleSection: article.category, keywords: article.keywords?.join(", ") || undefined, inLanguage: "fr-FR"
      },
      breadcrumbJsonLd([{ name: "Accueil", path: "/" }, { name: "Le journal", path: "/blog" }, { name: article.title, path: `/blog/${article.slug}` }])
    ]
  } : null);
  if (notFound) return <NotFound title="Article introuvable" message="Cet article n’existe pas ou n’est plus en ligne." />;
  if (!article) return <Layout><section className="page article-page" aria-busy="true"><div className="skeleton" style={{ height: 20, width: 140 }} /><div className="skeleton" style={{ height: 48, width: "90%", marginTop: 16 }} /><div className="skeleton" style={{ aspectRatio: "3 / 2", marginTop: 24 }} /></section></Layout>;
  return <Layout><article className="page article-page">
    <nav className="breadcrumb" aria-label="Fil d’Ariane"><Link to="/blog"><ArrowLeft size={16} aria-hidden="true" />Le journal</Link></nav>
    <p className="article-meta">{article.category}{article.publishedAt && <> · <time dateTime={article.publishedAt}>{publishedDate(article.publishedAt)}</time></>}</p>
    <h1>{article.title}</h1>
    {article.excerpt && <p className="page-lead">{article.excerpt}</p>}
    {article.imageUrl && <figure className="article-cover-figure"><div className="article-cover"><ArticleCover imageUrl={article.imageUrl} priority sizes="(min-width: 800px) 760px, 100vw" /></div>{article.imageAiGenerated && <figcaption>Illustration générée par IA</figcaption>}</figure>}
    <ArticleBody content={article.content} />
    <aside className="article-end">
      <p>Envie de passer de la lecture à la rencontre ?</p>
      <Link className="button" to="/events">Voir les prochaines soirées</Link>
    </aside>
  </article></Layout>;
}
