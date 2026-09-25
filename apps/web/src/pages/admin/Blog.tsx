import { Inbox } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { Layout } from "../../components/Layout";
import { ArticleBody, articleCoverPhoto } from "../../components/ArticleBody";
import { Picture } from "../../components/brand";
import { Loading, Notice } from "../../components/ui";
import { imgUrl } from "../../lib/format";
import { BLOG_CATEGORIES } from "../../lib/labels";
import { AdminNav } from "./AdminNav";

const ARTICLE_STATUS_LABEL:Record<string,string>={DRAFT:"Brouillon",IN_REVIEW:"En validation",APPROVED:"Validé",PUBLISHED:"Publié",ARCHIVED:"Archivé"};

export function AdminBlog() {
  const [items,setItems]=useState<any[]>([]);
  const [status,setStatus]=useState("");
  const [genForm,setGenForm]=useState({topic:"",category:BLOG_CATEGORIES[0]});
  const [newForm,setNewForm]=useState({title:"",category:BLOG_CATEGORIES[0]});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [queue,setQueue]=useState<{count:number;next:{title:string;category:string}[]}|null>(null);
  const navigate=useNavigate();
  const load=useCallback(()=>api<any[]>(`/admin/articles${status?`?status=${status}`:""}`).then(setItems),[status]);
  useEffect(()=>{load();api<{count:number;next:{title:string;category:string}[]}>("/admin/articles/queue").then(setQueue).catch(()=>{})},[load]);
  const slugify=(t:string)=>t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

  const generate=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{const article=await api<{id:string}>("/admin/articles/generate",{method:"POST",body:JSON.stringify(genForm)});navigate(`/admin/blog/${article.id}`)}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const createManual=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{
      const article=await api<{id:string}>("/admin/articles",{method:"POST",body:JSON.stringify({title:newForm.title,slug:`${slugify(newForm.title)}-${Date.now().toString().slice(-5)}`,category:newForm.category,content:"À rédiger.",keywords:[]})});
      navigate(`/admin/blog/${article.id}`);
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Blog</h1><p className="fine left">En production, un article est rédigé par l’IA (avec recherche web et sources vérifiées) puis publié automatiquement chaque jour, sans validation préalable. Vous pouvez consulter chaque article publié et le supprimer. Les articles écrits ici à la main suivent toujours le circuit de validation ci-dessous.</p>
    
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="admin-grid">
      <form className="panel form-grid" onSubmit={createManual}>
        <div className="panel-title"><h2>Nouvel article</h2></div>
        <label>Titre<input required value={newForm.title} onChange={e=>setNewForm({...newForm,title:e.target.value})}/></label>
        <label>Thème<select value={newForm.category} onChange={e=>setNewForm({...newForm,category:e.target.value})}>{BLOG_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <button className="button small" disabled={busy}>Créer et modifier</button>
      </form>
      <form className="panel form-grid" onSubmit={generate}>
        <div className="panel-title"><h2>Générer un brouillon (IA)</h2></div>
        <label>Sujet<input required value={genForm.topic} onChange={e=>setGenForm({...genForm,topic:e.target.value})} placeholder="Ex. : bien communiquer après une dispute"/></label>
        <label>Thème<select value={genForm.category} onChange={e=>setGenForm({...genForm,category:e.target.value})}>{BLOG_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <button className="button small secondary" disabled={busy}>Générer un brouillon</button>
      </form>
    </div>
    <div className="filters"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(ARTICLE_STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
    {items.length===0?<div className="empty"><Inbox size={24} aria-hidden="true"/><h2>Aucun article</h2></div>:<div className="panel table">
      <div className="table-row head"><span>Titre</span><span>Thème</span><span>Statut</span></div>
      {items.map(a=><Link key={a.id} to={`/admin/blog/${a.id}`} className="table-row"><span><b>{a.title}</b>{a.autoPublishDay?<small>Publié automatiquement le {new Date(`${a.autoPublishDay}T12:00:00`).toLocaleDateString("fr-FR")}</small>:a.aiGenerated&&<small>Généré par IA</small>}</span><span>{a.category}</span><span>{ARTICLE_STATUS_LABEL[a.status]}</span></Link>)}
    </div>}
  {queue&&queue.count>0&&<Notice kind="info">{queue.count} article{queue.count>1?"s":""} en réserve, proposé{queue.count>1?"s":""} ici à raison d’un par jour une fois en production. Prochain : « {queue.next[0]?.title} » ({queue.next[0]?.category}).</Notice>}</div></section></Layout>;
}

export function AdminArticleEditor() {
  const {id}=useParams();
  const navigate=useNavigate();
  const [article,setArticle]=useState<any>(null);
  const [form,setForm]=useState({title:"",slug:"",excerpt:"",content:"",category:"",keywords:"",metaTitle:"",metaDescription:""});
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [preview,setPreview]=useState(false);
  const [socialCopy,setSocialCopy]=useState<any[]|null>(null);
  const [scheduleAt,setScheduleAt]=useState("");
  const [rejectNote,setRejectNote]=useState("");

  const load=useCallback(()=>api<any>(`/admin/articles/${id}`).then(a=>{setArticle(a);setForm({title:a.title,slug:a.slug,excerpt:a.excerpt??"",content:a.content,category:a.category,keywords:(a.keywords??[]).join(", "),metaTitle:a.metaTitle??"",metaDescription:a.metaDescription??""})}),[id]);
  useEffect(()=>{load()},[load]);

  const save=async(e:FormEvent)=>{
    e.preventDefault();setBusy("save");setNotice(null);
    try{await api(`/admin/articles/${id}`,{method:"PATCH",body:JSON.stringify({...form,keywords:form.keywords.split(",").map(k=>k.trim()).filter(Boolean)})});setNotice({kind:"success",text:"Enregistré."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const action=async(path:string,body?:unknown)=>{
    setBusy(path);setNotice(null);
    try{await api(`/admin/articles/${id}/${path}`,{method:"POST",body:body?JSON.stringify(body):undefined});setNotice({kind:"success",text:"Mis à jour."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const uploadImage=async(file:File)=>{
    const body=new FormData();body.append("file",file);
    try{await api(`/admin/articles/${id}/image`,{method:"POST",body});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const generateSocial=async()=>{
    setBusy("social");setNotice(null);
    try{setSocialCopy(await api<any[]>(`/admin/articles/${id}/social-copy`,{method:"POST"}))}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const [confirmDelete,setConfirmDelete]=useState(false);
  const remove=async()=>{setBusy("delete");try{await api(`/admin/articles/${id}`,{method:"DELETE"});navigate("/admin/blog")}catch(err){setNotice({kind:"error",text:(err as Error).message});setBusy(null)}};

  if(!article)return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><Loading/></div></section></Layout>;
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main">
    <div className="admin-heading"><div><h1>{article.title}</h1><p className="fine left">Statut : <b>{ARTICLE_STATUS_LABEL[article.status]}</b>{article.aiGenerated&&" · généré par IA"}</p></div><button type="button" className="button small secondary" onClick={()=>setPreview(!preview)}>{preview?"Modifier":"Aperçu"}</button></div>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {preview?<div className="panel" style={{maxWidth:760}}>
      <p className="article-meta">{form.category}</p><h2>{form.title}</h2>
      {article.imageUrl&&<div className="article-cover">{articleCoverPhoto(article.imageUrl)?<Picture name={articleCoverPhoto(article.imageUrl)!} alt="" sizes="760px"/>:<img src={imgUrl(article.imageUrl)} alt=""/>}</div>}
      <ArticleBody content={form.content}/>
    </div>:<form className="panel form-grid" onSubmit={save}>
      <label>Titre<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
      <label>Identifiant (slug)<input required pattern="[a-z0-9-]+" value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label>
      <label>Thème<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{BLOG_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label>Mots-clés (séparés par des virgules)<input value={form.keywords} onChange={e=>setForm({...form,keywords:e.target.value})}/></label>
      <label className="wide">Extrait<textarea value={form.excerpt} onChange={e=>setForm({...form,excerpt:e.target.value})}/></label>
      <label className="wide">Contenu (blocs séparés par une ligne vide : « ## » intertitre, « - » liste, ![alt](photo:nom) image, [[cta:/events|Libellé]] bouton)<textarea required style={{minHeight:260}} value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/></label>
      <label>Titre SEO (facultatif)<input value={form.metaTitle} onChange={e=>setForm({...form,metaTitle:e.target.value})}/></label>
      <label>Méta-description SEO (facultatif)<input value={form.metaDescription} onChange={e=>setForm({...form,metaDescription:e.target.value})}/></label>
      <label className="fine wide">Image principale{article.imageUrl&&!articleCoverPhoto(article.imageUrl)&&<img src={imgUrl(article.imageUrl)} alt="" style={{width:220,borderRadius:8,display:"block",margin:"8px 0"}}/>}{articleCoverPhoto(article.imageUrl)&&<span className="fine"> (photo de la photothèque : {articleCoverPhoto(article.imageUrl)})</span>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>e.target.files?.[0]&&uploadImage(e.target.files[0])}/></label>
      <button className="button" disabled={busy==="save"}>Enregistrer</button>
    </form>}
    <div className="panel" style={{marginTop:20}}>
      <div className="panel-title"><h2>{article.status==="PUBLISHED"?"Article publié":"Circuit de validation"}</h2>{article.status==="PUBLISHED"&&<Link className="link-button" to={`/blog/${article.slug}`}>Voir en ligne</Link>}</div>
      <div className="decision-buttons">
        {article.status==="DRAFT"&&<button className="button" disabled={!!busy} onClick={()=>action("submit-for-review")}>Soumettre à validation</button>}
        {article.status==="IN_REVIEW"&&<><button className="button" disabled={!!busy} onClick={()=>action("decision",{accept:true})}>Valider</button><div className="reject-note"><input value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Motif du renvoi (optionnel)"/><button className="button danger" disabled={!!busy} onClick={()=>action("decision",{accept:false,note:rejectNote})}>Renvoyer en brouillon</button></div></>}
        {article.status==="APPROVED"&&<><button className="button" disabled={!!busy} onClick={()=>action("publish")}>Publier maintenant</button><div className="time-row"><input type="datetime-local" value={scheduleAt} onChange={e=>setScheduleAt(e.target.value)}/><button className="button secondary" disabled={!!busy||!scheduleAt} onClick={()=>action("schedule",{publishAt:new Date(scheduleAt).toISOString()})}>Programmer</button></div></>}
        {article.status==="PUBLISHED"&&<button className="button secondary" disabled={!!busy} onClick={()=>action("archive")}>Archiver</button>}
        {confirmDelete
          ?<><button className="button danger" disabled={!!busy} onClick={remove}>{busy==="delete"?"Suppression…":"Confirmer la suppression définitive"}</button><button className="button secondary" disabled={!!busy} onClick={()=>setConfirmDelete(false)}>Annuler</button></>
          :<button className="button danger" disabled={!!busy} onClick={()=>setConfirmDelete(true)}>{article.status==="PUBLISHED"?"Supprimer cet article publié":"Supprimer"}</button>}
      </div>
      {article.scheduledAt&&<p className="fine left">Publication programmée le {new Date(article.scheduledAt).toLocaleString("fr-FR")}.</p>}
    </div>
    {article.status==="PUBLISHED"&&<InstagramPanel article={article} onChanged={load}/>}
    {article.status==="PUBLISHED"&&<FacebookPanel article={article} onChanged={load}/>}
    <div className="panel" style={{marginTop:20}}>
      <div className="panel-title"><h2>Propositions sociales (IA)</h2><button type="button" className="button small secondary" disabled={busy==="social"} onClick={generateSocial}>Générer</button></div>
      {socialCopy&&<div className="stack">{socialCopy.map((s,i)=><div key={i} className="notice"><b>{s.platform}</b><p>{s.text}</p></div>)}</div>}
    </div>
    {article.reviewLogs?.length>0&&<div className="panel" style={{marginTop:20}}>
      <div className="panel-title"><h2>Journal de validation</h2></div>
      {article.reviewLogs.map((l:any)=><p key={l.id} className="fine left">{new Date(l.createdAt).toLocaleString("fr-FR")} — {ARTICLE_STATUS_LABEL[l.fromStatus]} → {ARTICLE_STATUS_LABEL[l.toStatus]}{l.note?` : ${l.note}`:""}</p>)}
    </div>}
  </div></section></Layout>;
}

// Publication Instagram (corrections du 2026-09-24) : faite automatiquement pour l'article du jour ;
// ici, on voit son état et on peut relancer une publication échouée, avec une légende modifiable.
function InstagramPanel({article,onChanged}:{article:any;onChanged:()=>void}){
  const [caption,setCaption]=useState(article.instagramCaption??"");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const publish=async()=>{
    setBusy(true);setNotice(null);
    try{await api(`/admin/articles/${article.id}/instagram`,{method:"POST",body:JSON.stringify(caption.trim()?{caption}:{})});setNotice({kind:"success",text:"Publié sur Instagram."});onChanged()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  return <div className="panel form-grid" style={{marginTop:20}}>
    <div className="panel-title"><h2>Instagram</h2><span>{article.instagramMediaId?`Publié le ${new Date(article.instagramPublishedAt).toLocaleString("fr-FR")}`:article.instagramError?"Échec de publication":"Non publié"}</span></div>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {article.instagramError&&!article.instagramMediaId&&<Notice kind="error">{article.instagramError}</Notice>}
    {article.imageAiGenerated&&<p className="fine left wide">Illustration générée par IA et contrôlée automatiquement avant publication.</p>}
    {!article.instagramMediaId&&<>
      <label className="wide">Légende (2 200 caractères maximum, liens non cliquables sur Instagram)<textarea maxLength={2200} style={{minHeight:160}} value={caption} onChange={e=>setCaption(e.target.value)}/></label>
      <button type="button" className="button small" disabled={busy} onClick={publish}>{busy?"Publication…":"Publier sur Instagram"}</button>
    </>}
  </div>;
}

// Publication sur la Page Facebook (décision du 2026-09-25) : même carrousel qu'Instagram, avec un lien
// cliquable vers l'article ; faite automatiquement pour l'article du jour, relançable ici après un échec.
function FacebookPanel({article,onChanged}:{article:any;onChanged:()=>void}){
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const publish=async()=>{
    if(busy)return;setBusy(true);setNotice(null);
    try{await api(`/admin/articles/${article.id}/facebook`,{method:"POST"});setNotice({kind:"success",text:"Publié sur Facebook."});onChanged()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  return <div className="panel form-grid" style={{marginTop:"var(--s-5)"}}>
    <div className="panel-title"><h2>Facebook</h2><span>{article.facebookPostId?`Publié le ${new Date(article.facebookPublishedAt).toLocaleString("fr-FR")}`:article.facebookError?"Échec de publication":"Non publié"}</span></div>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {article.facebookError&&!article.facebookPostId&&<Notice kind="error">{article.facebookError}</Notice>}
    {!article.facebookPostId&&<>
      <p className="fine left wide">Le carrousel est publié sur la Page avec le titre, le chapô et le lien vers l’article.</p>
      <button type="button" className="button small" disabled={busy} onClick={publish}>{busy?"Publication…":"Publier sur Facebook"}</button>
    </>}
  </div>;
}
