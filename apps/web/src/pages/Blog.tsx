import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout } from "../components/Layout";
import { Loading, renderArticleParagraph } from "../components/ui";
import { imgUrl } from "../lib/format";
import { BLOG_CATEGORIES } from "../lib/labels";

export function Blog() {
  const [articles,setArticles]=useState<any[]>([]);
  const [category,setCategory]=useState("");
  useEffect(()=>{api<any[]>(`/articles${category?`?category=${encodeURIComponent(category)}`:""}`).then(setArticles).catch(()=>{})},[category]);
  return <Layout><section className="page"><span className="eyebrow">LE BLOG</span><h1>Rencontres, amitié et vie sociale.</h1>
    <div className="filters"><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Tous les thèmes</option>{BLOG_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
    {articles.length===0?<div className="empty"><span>◇</span><h2>Aucun article pour le moment</h2></div>:<div className="event-grid">{articles.map(a=><Link key={a.id} to={`/blog/${a.slug}`} className="event-card"><div className="event-art">{a.imageUrl?<img src={imgUrl(a.imageUrl)} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span className="eyebrow">{a.category.toUpperCase()}</span>}</div><div className="event-copy"><small>{a.category.toUpperCase()}</small><h3>{a.title}</h3><p>{a.excerpt}</p></div></Link>)}</div>}
  </section></Layout>;
}

export function ArticlePage() {
  const {id}=useParams();
  const [article,setArticle]=useState<any>(null);
  const [notFound,setNotFound]=useState(false);
  useEffect(()=>{api<any>(`/articles/${id}`).then(setArticle).catch(()=>setNotFound(true))},[id]);
  useEffect(()=>{
    if(!article)return;
    document.title=article.metaTitle||`${article.title} — Nūr Meet`;
    let meta=document.querySelector('meta[name="description"]');
    if(!meta){meta=document.createElement("meta");meta.setAttribute("name","description");document.head.appendChild(meta)}
    meta.setAttribute("content",article.metaDescription||article.excerpt||"");
    // C31 : données structurées réelles (Article), jamais un graphique/schéma décoratif — uniquement
    // les champs dont on dispose vraiment (pas d'auteur générique inventé si l'article n'en a pas).
    const script=document.createElement("script");
    script.type="application/ld+json";
    script.text=JSON.stringify({
      "@context":"https://schema.org","@type":"Article",
      headline:article.title, description:article.excerpt??undefined,
      image:article.imageUrl?imgUrl(article.imageUrl):undefined,
      datePublished:article.publishedAt??undefined, dateModified:article.updatedAt??article.publishedAt??undefined,
      author:article.author?{"@type":"Person",name:article.author.displayName}:undefined,
      publisher:{"@type":"Organization",name:"Nūr Meet"}
    });
    document.head.appendChild(script);
    return ()=>{document.title="Nūr Meet";script.remove()};
  },[article]);
  if(notFound)return <Layout><div className="empty"><span>◇</span><h2>Article introuvable</h2></div></Layout>;
  if(!article)return <Layout><Loading/></Layout>;
  return <Layout><section className="page" style={{maxWidth:760}}>
    <span className="eyebrow">{article.category.toUpperCase()}</span>
    <h1>{article.title}</h1>
    {article.author&&<p className="fine">Par {article.author.displayName} · {new Date(article.publishedAt).toLocaleDateString("fr-FR")}</p>}
    {article.imageUrl&&<img src={imgUrl(article.imageUrl)} alt="" style={{width:"100%",borderRadius:14,margin:"20px 0"}}/>}
    <div className="article-body">{article.content.split("\n\n").map((p:string,i:number)=><p key={i}>{renderArticleParagraph(p)}</p>)}</div>
    {article.keywords?.length>0&&<div className="chips" style={{marginTop:30}}>{article.keywords.map((k:string)=><span key={k}>{k}</span>)}</div>}
  </section></Layout>;
}
