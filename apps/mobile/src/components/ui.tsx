import * as WebBrowser from "expo-web-browser";
import { Image, Pressable, Text, View } from "react-native";
import { WEB_URL } from "../api";
import { categoryColor, imgUrl, money, when } from "../format";
import { C, s } from "../theme";
import { Tab } from "../types";

export function Logo(){return <View style={s.logo}><View style={s.logoMark}><Text style={s.logoN}>N</Text></View><Text style={s.logoText}>NŪR <Text style={{color:C.gold}}>MEET</Text></Text></View>}
export function GoldButton({title,onPress,secondary=false,disabled=false}:{title:string,onPress:()=>void,secondary?:boolean,disabled?:boolean}){return <Pressable disabled={disabled} onPress={onPress} style={[s.button,secondary&&s.buttonSecondary,disabled&&{opacity:.5}]}><Text style={[s.buttonText,secondary&&{color:C.cream}]}>{title}</Text></Pressable>}
export function ScreenTitle({eyebrow,title,action}:{eyebrow?:string,title:string,action?:React.ReactNode}){return <View style={s.titleRow}><View>{eyebrow&&<Text style={s.eyebrow}>{eyebrow}</Text>}<Text style={s.screenTitle}>{title}</Text></View>{action}</View>}
export function Avatar({name,size=48,photoUrl,verified}:{name:string,size?:number,photoUrl?:string|null,verified?:boolean}){
  const img=photoUrl?<Image source={{uri:imgUrl(photoUrl)}} style={{width:size,height:size,borderRadius:size/2}}/>:<View style={[s.avatar,{width:size,height:size,borderRadius:size/2}]}><Text style={[s.avatarText,{fontSize:size*.3}]}>{name.slice(0,2).toUpperCase()}</Text></View>;
  if(!verified)return img;
  return <View>{img}<View style={s.verifiedBadge}><Text style={s.verifiedBadgeText}>✓</Text></View></View>;
}
export function Notice({text,error=false}:{text:string,error?:boolean}){return <View style={[s.notice,error&&{borderLeftColor:C.red}]}><Text style={s.noticeText}>{text}</Text></View>}
// Indication speed dating/networking (correctif §1/§4) : un point de couleur suffit à distinguer les
// deux catégories, sans dépendre d'une librairie d'icônes SVG absente du projet mobile.
export function CategoryChip({category}:{category:string}){const color=categoryColor(category);return <View style={s.categoryChip}><View style={[s.categoryDot,{backgroundColor:color}]}/><Text style={[s.categoryChipText,{color}]}>{category}</Text></View>}

// C24 (ordre correctif 2026-09-20) : jamais de capacité/quota brut affiché — seulement la
// disponibilité déjà réduite par le serveur à ce qui concerne ce visiteur (event.availability).
export const availabilityLabel=(a:any)=>a.kind==="unknown"?"Places selon catégorie":a.full?"Complet":`${a.remaining} place${a.remaining>1?"s":""}`;
export function EventCard({event,onPress}:{event:any,onPress:()=>void}){
  const priceLabel=event.priceTiers?.length>0?`À partir de ${money(Math.min(...event.priceTiers.map((t:any)=>t.amountCents)))}`:money(event.priceCents);
  return <Pressable onPress={onPress} style={s.eventCard}><View style={s.eventArt}><Text style={s.eventDay}>{new Date(event.startsAt).getDate()}</Text><Text style={s.eventMonth}>{new Date(event.startsAt).toLocaleString("fr-FR",{month:"short"}).toUpperCase()}</Text></View><View style={s.eventCopy}><Text style={[s.eyebrow,{color:categoryColor(event.category)}]}>{event.category.toUpperCase()} · {when(event.startsAt)}</Text><Text style={s.eventTitle}>{event.title}</Text><Text style={s.meta}>{event.district} · {availabilityLabel(event.availability)}</Text><Text style={s.price}>{priceLabel}</Text></View></Pressable>;
}

// Case d'acceptation d'un texte juridique : le lien ouvre la page web correspondante (source unique
// des textes, apps/web/src/legal/*.md) dans le navigateur intégré.
const openLegal=(slug:string)=>WebBrowser.openBrowserAsync(`${WEB_URL}/legal/${slug}`);
export function ConsentCheck({checked,onChange,children}:{checked:boolean,onChange:(v:boolean)=>void,children:React.ReactNode}){
  return <Pressable onPress={()=>onChange(!checked)} style={{flexDirection:"row",alignItems:"flex-start",gap:10,marginVertical:10}} accessibilityRole="checkbox" accessibilityState={{checked}}>
    <View style={{width:22,height:22,borderRadius:4,borderWidth:1.5,borderColor:C.gold,backgroundColor:checked?C.gold:"transparent",alignItems:"center",justifyContent:"center",marginTop:1}}>{checked&&<Text style={{color:"#111",fontWeight:"700"}}>✓</Text>}</View>
    <Text style={{flex:1,color:C.cream,fontSize:14,lineHeight:20}}>{children}</Text>
  </Pressable>;
}
export const legalLink=(label:string,slug:string)=><Text style={{color:C.gold,textDecorationLine:"underline"}} onPress={()=>openLegal(slug)}>{label}</Text>;

export function ToggleChip({label,active,onPress}:{label:string,active:boolean,onPress:()=>void}){return <Pressable onPress={onPress} style={[s.choiceChip,active&&s.choiceChipActive]}><Text style={[s.choiceChipText,active&&{color:"#111"}]}>{label}</Text></Pressable>}

export function TabBar({tab,setTab,profileLabel}:{tab:Tab,setTab:(t:Tab)=>void,profileLabel:string}){const tabs:[Tab,string,string][]=[["home","⌂","Accueil"],["events","◇","Événements"],["scan","⌗","Scanner"],["messages","○","Messages"],["profile","●",profileLabel]];return <View style={s.tabBar}>{tabs.map(([id,icon,label])=><Pressable key={id} onPress={()=>setTab(id)} style={[s.tabItem,id==="scan"&&s.scanTab]}><Text style={[s.tabIcon,tab===id&&{color:id==="scan"?"#111":C.gold}]}>{icon}</Text><Text style={[s.tabLabel,tab===id&&{color:C.gold}]}>{label}</Text></Pressable>)}</View>}
