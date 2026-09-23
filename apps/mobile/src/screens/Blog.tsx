import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { ScreenTitle } from "../components/ui";
import { imgUrl } from "../format";
import { BLOG_CATEGORIES } from "../labels";
import { s } from "../theme";
import { Tab } from "../types";

export function Blog({setTab,goToEvents}:{setTab:(t:Tab)=>void,goToEvents:(category:string)=>void}){
  const [articles,setArticles]=useState<any[]>([]);
  const [category,setCategory]=useState("");
  const [selected,setSelected]=useState<any>(null);
  useEffect(()=>{api<any[]>(`/articles${category?`?category=${encodeURIComponent(category)}`:""}`).then(setArticles).catch(()=>{})},[category]);
  const openArticle=(slug:string)=>api<any>(`/articles/${slug}`).then(setSelected).catch(()=>{});
  // §5 (cahier des charges 2026-09) : même convention de lien "[libellé](/chemin)" que côté web
  // (voir renderArticleParagraph dans apps/web/src/App.tsx) — un article doit pouvoir renvoyer vers
  // une autre partie de l'app, pas seulement exister pour le SEO.
  const renderParagraph=(text:string)=>{
    const parts=text.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part,i)=>{
      const match=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if(!match)return <Text key={i}>{part}</Text>;
      const [,label,url]=match;
      const onPress=()=>{
        if(url.startsWith("/events")){const m=url.match(/category=([^&]+)/);goToEvents(m?decodeURIComponent(m[1]):"")}
        else if(url.startsWith("/concept"))setTab("concept");
        else if(url.startsWith("/blog"))setSelected(null);
      };
      return <Text key={i} onPress={onPress} style={s.link}>{label}</Text>;
    });
  };

  if(selected)return <ScrollView contentContainerStyle={s.content}>
    <Pressable onPress={()=>setSelected(null)}><Text style={s.back}>‹ Retour</Text></Pressable>
    <Text style={[s.eyebrow,{marginTop:6}]}>{selected.category.toUpperCase()}</Text>
    <Text style={s.detailTitle}>{selected.title}</Text>
    {selected.author&&<Text style={s.meta}>Par {selected.author.displayName} · {new Date(selected.publishedAt).toLocaleDateString("fr-FR")}</Text>}
    {selected.imageUrl&&<Image source={{uri:imgUrl(selected.imageUrl)}} style={{width:"100%",height:220,borderRadius:14,marginVertical:16}}/>}
    {selected.content.split("\n\n").map((p:string,i:number)=><Text key={i} style={[s.paragraph,{marginBottom:14}]}>{renderParagraph(p)}</Text>)}
    {selected.keywords?.length>0&&<View style={s.chips}>{selected.keywords.map((k:string)=><Text key={k} style={s.chip}>{k}</Text>)}</View>}
  </ScrollView>;

  return <ScrollView contentContainerStyle={s.content}>
    <Pressable onPress={()=>setTab("home")}><Text style={s.back}>‹ Retour</Text></Pressable>
    <ScreenTitle eyebrow="LE BLOG" title="Rencontres, amitié et vie sociale."/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:16}} contentContainerStyle={{gap:8}}>
      <Pressable onPress={()=>setCategory("")} style={[s.choiceChip,!category&&s.choiceChipActive]}><Text style={[s.choiceChipText,!category&&{color:"#111"}]}>Tous les thèmes</Text></Pressable>
      {BLOG_CATEGORIES.map(c=><Pressable key={c} onPress={()=>setCategory(c)} style={[s.choiceChip,category===c&&s.choiceChipActive]}><Text style={[s.choiceChipText,category===c&&{color:"#111"}]}>{c}</Text></Pressable>)}
    </ScrollView>
    {articles.length===0?<Text style={s.meta}>Aucun article pour le moment.</Text>:articles.map(a=>
      <Pressable key={a.id} onPress={()=>openArticle(a.slug)} style={s.reservationCard}>
        {a.imageUrl&&<Image source={{uri:imgUrl(a.imageUrl)}} style={{width:"100%",height:140,borderRadius:8,marginBottom:10}}/>}
        <Text style={s.eyebrow}>{a.category.toUpperCase()}</Text>
        <Text style={s.sectionTitle}>{a.title}</Text>
        <Text style={s.paragraph}>{a.excerpt}</Text>
      </Pressable>
    )}
  </ScrollView>;
}
