import { VideoView, useVideoPlayer } from "expo-video";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { Avatar, EventCard, ScreenTitle } from "../components/ui";
import { when } from "../format";
import { C, s } from "../theme";
import { Tab } from "../types";

export function Home({user,setTab}:{user:any,setTab:(t:Tab)=>void}){
  const [events,setEvents]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]);useEffect(()=>{api<{items:any[]}>("/events").then(r=>setEvents(r.items));api<any[]>("/me/tickets").then(setTickets)},[]);
  return <ScrollView contentContainerStyle={s.content}><View style={s.hello}><View><Text style={s.eyebrow}>BONJOUR {user.displayName.toUpperCase()}</Text><Text style={s.homeTitle}>Votre prochaine{`\n`}rencontre commence ici.</Text></View><Avatar name={user.displayName} photoUrl={user.profile?.photoUrl}/></View>{tickets[0]&&<Pressable style={s.ticketMini} onPress={()=>setTab("profile")}><View><Text style={s.eyebrow}>{when(tickets[0].reservation.event.startsAt).toUpperCase()}</Text><Text style={s.ticketTitle}>{tickets[0].reservation.event.title}</Text><Text style={{color:C.green,fontWeight:"700"}}>Billet confirmé</Text></View><Image source={{uri:tickets[0].qrDataUrl}} style={s.miniQr}/></Pressable>}<ScreenTitle title="À découvrir" action={<Pressable onPress={()=>setTab("events")}><Text style={s.link}>Voir tout</Text></Pressable>}/>{events.slice(0,2).map(e=><EventCard event={e} onPress={()=>setTab("events")} key={e.id}/>)}<ScreenTitle title="Pour vous"/><View style={s.chips}><Text style={s.chipGold}>Rencontres</Text><Text style={s.chip}>Networking</Text><Text style={s.chip}>Culture</Text></View><View style={{flexDirection:"row",gap:20}}><Pressable onPress={()=>setTab("concept")}><Text style={s.link}>Le concept →</Text></Pressable><Pressable onPress={()=>setTab("blog")}><Text style={s.link}>Le blog →</Text></Pressable></View></ScrollView>
}

// §16 : résumé écrit toujours disponible sans lancer de vidéo (la vidéo elle-même n'est pas
// intégrée sur mobile — pas de lecteur natif ajouté pour l'instant, contrairement au web).
export function Concept({setTab}:{setTab:(t:Tab)=>void}){
  const [video,setVideo]=useState<{url:string;thumbnail:string;subtitles:string}|null>(null);
  useEffect(()=>{api<any>("/concept-video").then(setVideo).catch(()=>{})},[]);
  const player=useVideoPlayer(null,p=>{p.loop=false});
  useEffect(()=>{if(video?.url)player.replace(video.url)},[video?.url]);
  return <ScrollView contentContainerStyle={s.content}><Pressable onPress={()=>setTab("home")}><Text style={s.back}>‹ Retour</Text></Pressable><ScreenTitle eyebrow="LE CONCEPT" title="Comment fonctionne Nūr Meet."/>
    {video?.url?<VideoView player={player} style={{width:"100%",height:220,borderRadius:14,marginTop:10}} nativeControls/>
    :<View style={[s.scanPlaceholder,{height:220,marginTop:10,marginBottom:0}]}><Text style={s.scanIcon}>▶</Text><Text style={[s.meta,{textAlign:"center",paddingHorizontal:20}]}>La vidéo de présentation (60 à 90 secondes) sera bientôt disponible ici. En attendant, voici comment tout fonctionne :</Text></View>}
    {[
      ["01","Speed dating, avec sélection","Un questionnaire privé, un entretien téléphonique et une décision de notre équipe avant toute inscription : un cadre sérieux, pensé pour de vraies rencontres."],
      ["02","Networking, en accès direct","Un questionnaire professionnel non bloquant, puis une inscription immédiate : idéal pour élargir son réseau sans étape supplémentaire."],
      ["03","Des profils sérieux, un cadre respectueux","Chaque participant complète un profil et s’engage à respecter la charte de confidentialité et de respect mutuel de la communauté."],
      ["04","Paiement et billet","La place n’est acquise qu’après paiement confirmé ; un billet avec QR code personnel est alors délivré pour l’entrée."],
      ["05","Déroulement de la soirée","Accueil personnalisé, animation légère, temps libres, et la possibilité d’échanger un contact avec les personnes rencontrées."]
    ].map(([n,title,body])=><View key={n} style={{marginTop:20}}><Text style={s.eyebrow}>{n}</Text><Text style={s.sectionTitle}>{title}</Text><Text style={s.paragraph}>{body}</Text></View>)}
  </ScrollView>;
}
