import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { API_URL, api, getToken, setToken } from "./src/api";
import { SCREENING_QUESTIONS, NETWORKING_QUESTIONS, eventRequiresScreening, EVENT_CATEGORIES } from "@nour/shared";

// §15 : même code couleur par type d'événement que le web, pour une identité cohérente entre les
// deux plateformes (§2). Une catégorie inconnue retombe sur la couleur or par défaut.
const categoryColor = (category: string) => EVENT_CATEGORIES.find(c => c.name === category)?.color ?? "#cba969";
const APPLICATION_STATUS_LABEL: Record<string,string> = { PENDING_CALL: "En attente de choix d’un créneau", CALL_SCHEDULED: "Entretien programmé", CALL_COMPLETED: "Entretien réalisé", ACCEPTED: "Candidature acceptée", REFUSED: "Candidature refusée", PAYMENT_PENDING: "Acceptée · paiement à finaliser", CONFIRMED: "Place confirmée", CANCELLED: "Annulée", NO_SHOW: "Absence à l’entretien" };
const dayLabel = (v: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(v));
const timeLabel = (v: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(v));

const C={bg:"#0B0B0C",panel:"#171718",line:"#34322E",gold:"#C9A765",cream:"#F6F0E5",muted:"#918C82",green:"#62D89A",red:"#F0747C"};
type Tab="home"|"events"|"scan"|"messages"|"profile"|"concept"|"blog";
const BLOG_CATEGORIES=["Couple","Rencontre","Solitude","Mariage","Communication","Vie relationnelle"];
const money=(n:number)=>`${(n/100).toFixed(2).replace(".",",")} €`;
const when=(v:string)=>new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(v));

function Logo(){return <View style={s.logo}><View style={s.logoMark}><Text style={s.logoN}>N</Text></View><Text style={s.logoText}>NŪR <Text style={{color:C.gold}}>MEET</Text></Text></View>}
function GoldButton({title,onPress,secondary=false,disabled=false}:{title:string,onPress:()=>void,secondary?:boolean,disabled?:boolean}){return <Pressable disabled={disabled} onPress={onPress} style={[s.button,secondary&&s.buttonSecondary,disabled&&{opacity:.5}]}><Text style={[s.buttonText,secondary&&{color:C.cream}]}>{title}</Text></Pressable>}
function ScreenTitle({eyebrow,title,action}:{eyebrow?:string,title:string,action?:React.ReactNode}){return <View style={s.titleRow}><View>{eyebrow&&<Text style={s.eyebrow}>{eyebrow}</Text>}<Text style={s.screenTitle}>{title}</Text></View>{action}</View>}
function Avatar({name,size=48,photoUrl}:{name:string,size?:number,photoUrl?:string|null}){if(photoUrl)return <Image source={{uri:`${API_URL}${photoUrl}`}} style={{width:size,height:size,borderRadius:size/2}}/>;return <View style={[s.avatar,{width:size,height:size,borderRadius:size/2}]}><Text style={[s.avatarText,{fontSize:size*.3}]}>{name.slice(0,2).toUpperCase()}</Text></View>}
function Notice({text,error=false}:{text:string,error?:boolean}){return <View style={[s.notice,error&&{borderLeftColor:C.red}]}><Text style={s.noticeText}>{text}</Text></View>}
// Indication speed dating/networking (correctif §1/§4) : un point de couleur suffit à distinguer les
// deux catégories, sans dépendre d'une librairie d'icônes SVG absente du projet mobile.
function CategoryChip({category}:{category:string}){const color=categoryColor(category);return <View style={s.categoryChip}><View style={[s.categoryDot,{backgroundColor:color}]}/><Text style={[s.categoryChipText,{color}]}>{category}</Text></View>}

function Login({onLogin}:{onLogin:(opts?:{restaurateur?:boolean})=>void}){
  const [phone,setPhone]=useState(""),[code,setCode]=useState(""),[step,setStep]=useState<1|2|3>(1),[busy,setBusy]=useState(false),[error,setError]=useState(""),[devCode,setDevCode]=useState<string|null>(null);
  // isNewUser (renvoyé une seule fois, à la création du compte) déclenche l'écran de choix
  // participant/restaurateur, jamais revu ensuite — même logique que sur le web (voir Login() dans
  // apps/web/src/App.tsx).
  const submit=async()=>{setBusy(true);setError("");try{if(step===1){const r=await api<{delivery:"mock"|"sms";devCode?:string}>("/auth/request-otp",{method:"POST",body:JSON.stringify({phone})});setDevCode(r.devCode??null);setStep(2)}else{const r=await api<{token:string;isNewUser?:boolean}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone,code})});await setToken(r.token);if(r.isNewUser)setStep(3);else onLogin()}}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  if(step===3)return <SafeAreaView style={s.safe}><StatusBar style="light"/><View style={s.login}><Logo/><View style={s.loginHero}><Text style={s.eyebrow}>BIENVENUE</Text><Text style={s.loginTitle}>Que souhaitez-vous{`\n`}faire sur Nūr Meet ?</Text><Text style={s.paragraph}>Ce choix détermine votre espace ; il ne peut être fait qu’une seule fois, à la création du compte.</Text></View><GoldButton title="Participer aux événements" onPress={()=>onLogin()}/><GoldButton title="Je suis restaurateur" secondary onPress={()=>onLogin({restaurateur:true})}/></View></SafeAreaView>;
  return <SafeAreaView style={s.safe}><StatusBar style="light"/><KeyboardAvoidingView style={s.login} behavior={Platform.OS==="ios"?"padding":undefined}><Logo/><View style={s.loginHero}><Text style={s.eyebrow}>BIENVENUE</Text><Text style={s.loginTitle}>{step===1?"Votre numéro\nouvre la porte.":"Entrez le code\nreçu par SMS."}</Text><Text style={s.paragraph}>{step===1?"Connexion rapide et sécurisée, sans mot de passe.":`Code envoyé au ${phone}`}</Text></View>{error?<Notice text={error} error/>:null}<Text style={s.label}>{step===1?"NUMÉRO DE TÉLÉPHONE":"CODE À SIX CHIFFRES"}</Text><TextInput style={[s.input,step===2&&s.otp]} value={step===1?phone:code} onChangeText={step===1?setPhone:v=>setCode(v.replace(/\D/g,"").slice(0,6))} keyboardType="phone-pad" textContentType={step===2?"oneTimeCode":"telephoneNumber"} placeholderTextColor="#666" placeholder={step===1?"+33612345678":"••••••"}/><GoldButton title={busy?"Patientez…":step===1?"Recevoir mon code":"Vérifier"} onPress={submit} disabled={busy}/>{devCode?<View style={s.demo}><Text style={s.demoTitle}>MODE LOCAL — AUCUN SMS FACTURÉ</Text><Text style={s.meta}>Code de développement : {devCode}</Text></View>:null}</KeyboardAvoidingView></SafeAreaView>
}

function EventCard({event,onPress}:{event:any,onPress:()=>void}){return <Pressable onPress={onPress} style={s.eventCard}><View style={s.eventArt}><Text style={s.eventDay}>{new Date(event.startsAt).getDate()}</Text><Text style={s.eventMonth}>{new Date(event.startsAt).toLocaleString("fr-FR",{month:"short"}).toUpperCase()}</Text></View><View style={s.eventCopy}><Text style={[s.eyebrow,{color:categoryColor(event.category)}]}>{event.category.toUpperCase()} · {when(event.startsAt)}</Text><Text style={s.eventTitle}>{event.title}</Text><Text style={s.meta}>{event.district} · {event.capacity-event.confirmedCount} places</Text><Text style={s.price}>{money(event.priceCents)}</Text></View></Pressable>}

function Home({user,setTab}:{user:any,setTab:(t:Tab)=>void}){
  const [events,setEvents]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]);useEffect(()=>{api<any[]>("/events").then(setEvents);api<any[]>("/me/tickets").then(setTickets)},[]);
  return <ScrollView contentContainerStyle={s.content}><View style={s.hello}><View><Text style={s.eyebrow}>BONJOUR {user.displayName.toUpperCase()}</Text><Text style={s.homeTitle}>Votre prochaine{`\n`}rencontre commence ici.</Text></View><Avatar name={user.displayName} photoUrl={user.profile?.photoUrl}/></View>{tickets[0]&&<Pressable style={s.ticketMini} onPress={()=>setTab("profile")}><View><Text style={s.eyebrow}>{when(tickets[0].reservation.event.startsAt).toUpperCase()}</Text><Text style={s.ticketTitle}>{tickets[0].reservation.event.title}</Text><Text style={{color:C.green,fontWeight:"700"}}>Billet confirmé</Text></View><Image source={{uri:tickets[0].qrDataUrl}} style={s.miniQr}/></Pressable>}<ScreenTitle title="À découvrir" action={<Pressable onPress={()=>setTab("events")}><Text style={s.link}>Voir tout</Text></Pressable>}/>{events.slice(0,2).map(e=><EventCard event={e} onPress={()=>setTab("events")} key={e.id}/>)}<ScreenTitle title="Pour vous"/><View style={s.chips}><Text style={s.chipGold}>Rencontres</Text><Text style={s.chip}>Networking</Text><Text style={s.chip}>Culture</Text></View><View style={{flexDirection:"row",gap:20}}><Pressable onPress={()=>setTab("concept")}><Text style={s.link}>Le concept →</Text></Pressable><Pressable onPress={()=>setTab("blog")}><Text style={s.link}>Le blog →</Text></Pressable></View></ScrollView>
}

// §16 : résumé écrit toujours disponible sans lancer de vidéo (la vidéo elle-même n'est pas
// intégrée sur mobile — pas de lecteur natif ajouté pour l'instant, contrairement au web).
function Concept({setTab}:{setTab:(t:Tab)=>void}){
  return <ScrollView contentContainerStyle={s.content}><Pressable onPress={()=>setTab("home")}><Text style={s.back}>‹ Retour</Text></Pressable><ScreenTitle eyebrow="LE CONCEPT" title="Comment fonctionne Nūr Meet."/>
    {[
      ["01","Speed dating, avec sélection","Un questionnaire privé, un entretien téléphonique et une décision de notre équipe avant toute inscription : un cadre sérieux, pensé pour de vraies rencontres."],
      ["02","Networking, en accès direct","Un questionnaire professionnel non bloquant, puis une inscription immédiate : idéal pour élargir son réseau sans étape supplémentaire."],
      ["03","Des profils sérieux, un cadre respectueux","Chaque participant complète un profil et s’engage à respecter la charte de confidentialité et de respect mutuel de la communauté."],
      ["04","Paiement et billet","La place n’est acquise qu’après paiement confirmé ; un billet avec QR code personnel est alors délivré pour l’entrée."],
      ["05","Déroulement de la soirée","Accueil personnalisé, animation légère, temps libres, et la possibilité d’échanger un contact avec les personnes rencontrées."]
    ].map(([n,title,body])=><View key={n} style={{marginTop:20}}><Text style={s.eyebrow}>{n}</Text><Text style={s.sectionTitle}>{title}</Text><Text style={s.paragraph}>{body}</Text></View>)}
  </ScrollView>;
}

function Blog({setTab}:{setTab:(t:Tab)=>void}){
  const [articles,setArticles]=useState<any[]>([]);
  const [category,setCategory]=useState("");
  const [selected,setSelected]=useState<any>(null);
  useEffect(()=>{api<any[]>(`/articles${category?`?category=${encodeURIComponent(category)}`:""}`).then(setArticles).catch(()=>{})},[category]);
  const openArticle=(slug:string)=>api<any>(`/articles/${slug}`).then(setSelected).catch(()=>{});

  if(selected)return <ScrollView contentContainerStyle={s.content}>
    <Pressable onPress={()=>setSelected(null)}><Text style={s.back}>‹ Retour</Text></Pressable>
    <Text style={[s.eyebrow,{marginTop:6}]}>{selected.category.toUpperCase()}</Text>
    <Text style={s.detailTitle}>{selected.title}</Text>
    {selected.author&&<Text style={s.meta}>Par {selected.author.displayName} · {new Date(selected.publishedAt).toLocaleDateString("fr-FR")}</Text>}
    {selected.imageUrl&&<Image source={{uri:`${API_URL}${selected.imageUrl}`}} style={{width:"100%",height:220,borderRadius:14,marginVertical:16}}/>}
    {selected.content.split("\n\n").map((p:string,i:number)=><Text key={i} style={[s.paragraph,{marginBottom:14}]}>{p}</Text>)}
    {selected.keywords?.length>0&&<View style={s.chips}>{selected.keywords.map((k:string)=><Text key={k} style={s.chip}>{k}</Text>)}</View>}
  </ScrollView>;

  return <ScrollView contentContainerStyle={s.content}>
    <Pressable onPress={()=>setTab("home")}><Text style={s.back}>‹ Retour</Text></Pressable>
    <ScreenTitle eyebrow="LE BLOG" title="Couple, rencontre et vie relationnelle."/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:16}} contentContainerStyle={{gap:8}}>
      <Pressable onPress={()=>setCategory("")} style={[s.choiceChip,!category&&s.choiceChipActive]}><Text style={[s.choiceChipText,!category&&{color:"#111"}]}>Tous les thèmes</Text></Pressable>
      {BLOG_CATEGORIES.map(c=><Pressable key={c} onPress={()=>setCategory(c)} style={[s.choiceChip,category===c&&s.choiceChipActive]}><Text style={[s.choiceChipText,category===c&&{color:"#111"}]}>{c}</Text></Pressable>)}
    </ScrollView>
    {articles.length===0?<Text style={s.meta}>Aucun article pour le moment.</Text>:articles.map(a=>
      <Pressable key={a.id} onPress={()=>openArticle(a.slug)} style={s.reservationCard}>
        {a.imageUrl&&<Image source={{uri:`${API_URL}${a.imageUrl}`}} style={{width:"100%",height:140,borderRadius:8,marginBottom:10}}/>}
        <Text style={s.eyebrow}>{a.category.toUpperCase()}</Text>
        <Text style={s.sectionTitle}>{a.title}</Text>
        <Text style={s.paragraph}>{a.excerpt}</Text>
      </Pressable>
    )}
  </ScrollView>;
}

function Events({user}:{user:any}){
  const [events,setEvents]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[application,setApplication]=useState<any>(null),[message,setMessage]=useState(""),[showForm,setShowForm]=useState(false),[answers,setAnswers]=useState<Record<string,string>>({}),[submitting,setSubmitting]=useState(false);
  useEffect(()=>{api<any[]>("/events").then(setEvents)},[]);
  const loadApplication=(eventId:string)=>api<any>(`/events/${eventId}/my-application`).then(setApplication).catch(()=>setApplication(null));
  const openEvent=(e:any)=>{setSelected(e);setMessage("");setShowForm(false);setAnswers({});loadApplication(e.id)};
  const requiresScreening=selected?eventRequiresScreening(selected):false;
  const questions=requiresScreening?SCREENING_QUESTIONS:NETWORKING_QUESTIONS;
  const full=selected?selected.confirmedCount>=selected.capacity:false;
  const canCancel=application&&!["REFUSED","CANCELLED"].includes(application.status);
  // La candidature ne garantit jamais de place (elle enregistre le questionnaire et autorise
  // seulement à tenter le paiement) : le paiement par carte se termine depuis le site pour
  // l'instant, l'application mobile n'intègre pas encore le module de paiement Stripe.
  const apply=async()=>{
    setSubmitting(true);
    try{
      const body=requiresScreening?{screeningAnswers:answers}:{networkingAnswers:answers};
      const result=await api<any>(`/events/${selected.id}/apply`,{method:"POST",body:JSON.stringify(body)});
      setApplication(result.application);
      setMessage("Candidature envoyée. Finalisez le paiement par carte depuis le site nour-meet dans votre espace personnel.");
      setShowForm(false);
    }catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const cancel=async()=>{
    setSubmitting(true);
    try{
      const result=await api<{refunded:boolean;refundedAmountCents:number|null;eligible:boolean|null}>(`/me/applications/${application.id}/cancel`,{method:"POST"});
      setMessage(result.refunded?`Candidature annulée. ${money(result.refundedAmountCents!)} remboursés.`:"Candidature annulée.");
      await loadApplication(selected.id);
    }catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const joinWaitlist=async()=>{
    setSubmitting(true);
    try{await api(`/events/${selected.id}/waitlist`,{method:"POST"});setMessage("Vous êtes inscrit(e) sur la liste d’attente.")}
    catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const share=async()=>{
    try{
      const link=await api<{url:string}>(`/events/${selected.id}/share-link`,{method:"POST"});
      await Share.share({message:`Je vais à « ${selected.title} », viens avec moi : ${link.url}`});
    }catch(e){setMessage((e as Error).message)}
  };
  if(selected)return <ScrollView contentContainerStyle={s.content}><Pressable onPress={()=>{setSelected(null);setApplication(null)}}><Text style={s.back}>‹ Retour</Text></Pressable><View style={s.detailArt}><Text style={[s.eyebrow,{color:categoryColor(selected.category)}]}>{selected.category.toUpperCase()}</Text><Text style={s.detailTitle}>{selected.title}</Text></View><View style={s.detailFacts}><View><Text style={s.label}>DATE</Text><Text style={s.bodyStrong}>{when(selected.startsAt)}</Text></View><View><Text style={s.label}>LIEU</Text><Text style={s.bodyStrong}>{selected.district}</Text></View></View><Text style={s.sectionTitle}>Rencontrez autrement</Text><Text style={s.paragraph}>{selected.description}</Text><GoldButton title="J’y vais, viens avec moi" secondary onPress={share}/>{message?<Notice text={message} error={!message.includes("envoyée")&&!message.includes("annulée")&&!message.includes("attente")}/>:null}
    {application?<View>
      {canCancel?<GoldButton title={submitting?"…":"Annuler mon inscription"} secondary onPress={cancel} disabled={submitting}/>
      :<Text style={s.meta}>Statut : {application.status}</Text>}
    </View>
    :user.hasRestaurant?<Notice text="Votre compte restaurateur vous permet de découvrir les événements proposés, mais ne permet pas d’y participer."/>
    :showForm?<View>{questions.map(q=><View key={q.key}><Text style={s.label}>{q.label.toUpperCase()}</Text><TextInput style={[s.input,{height:60}]} multiline value={answers[q.key]??""} onChangeText={v=>setAnswers({...answers,[q.key]:v})}/></View>)}<GoldButton title={submitting?"Envoi…":"Envoyer ma candidature"} onPress={apply} disabled={submitting}/></View>
    :full?<View style={s.bookingBar}><Text style={s.meta}>Cet événement est complet</Text><GoldButton title={submitting?"…":"Rejoindre la liste d’attente"} onPress={joinWaitlist} disabled={submitting}/></View>
    :<View style={s.bookingBar}><View><Text style={s.meta}>À partir de</Text><Text style={s.bookingPrice}>{money(selected.priceCents)}</Text></View><GoldButton title={requiresScreening?"Candidater":"S’inscrire"} onPress={()=>setShowForm(true)}/></View>}
  </ScrollView>;
  return <ScrollView contentContainerStyle={s.content}><ScreenTitle eyebrow="CALENDRIER" title="Événements"/><TextInput style={s.search} placeholder="Rechercher" placeholderTextColor="#777"/>{events.map(e=><EventCard key={e.id} event={e} onPress={()=>openEvent(e)}/>)}</ScrollView>
}

function Scanner(){
  const [permission,requestPermission]=useCameraPermissions();const [active,setActive]=useState(false),[code,setCode]=useState("NOUR-KARIM-3902"),[profile,setProfile]=useState<any>(null),[error,setError]=useState("");
  const lookup=async(value=code)=>{setError("");try{setProfile(await api(`/profiles/code/${encodeURIComponent(value)}`));setActive(false)}catch(e){setProfile(null);setError((e as Error).message)}};
  const open=async()=>{if(!permission?.granted){const p=await requestPermission();if(!p.granted){Alert.alert("Caméra refusée","Vous pouvez saisir le code manuellement.");return}}setActive(true)};
  if(profile)return <ScrollView contentContainerStyle={s.content}><Pressable onPress={()=>setProfile(null)}><Text style={s.back}>‹ Scanner un autre code</Text></Pressable><View style={s.profilePreview}><Avatar name={profile.displayName} size={100} photoUrl={profile.photoUrl}/><Text style={s.profileName}>{profile.displayName}</Text><Text style={s.meta}>{profile.age?`${profile.age} ans · `:""}{profile.city}</Text><Text style={s.validated}>PROFIL VALIDÉ</Text></View><Text style={s.sectionTitle}>À propos</Text><Text style={s.paragraph}>{profile.bio}</Text><View style={s.chips}>{profile.interests?.map((x:string)=><Text style={s.chip} key={x}>{x}</Text>)}</View><GoldButton title="Envoyer une demande de contact" onPress={()=>api("/contacts/request",{method:"POST",body:JSON.stringify({recipientId:profile.userId})}).then(()=>Alert.alert("Demande envoyée","La messagerie s’ouvrira après acceptation."))}/></ScrollView>;
  return <View style={[s.content,{flex:1}]}><ScreenTitle title="Scanner un code"/>{active?<View style={s.cameraWrap}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{barcodeTypes:["qr"]}} onBarcodeScanned={({data})=>lookup(data)}/><View style={s.scanGuide}/></View>:<Pressable onPress={open} style={s.scanPlaceholder}><Text style={s.scanIcon}>⌗</Text><Text style={s.sectionTitle}>Ouvrir la caméra</Text><Text style={s.meta}>Cadrez le QR code personnel.</Text></Pressable>}{error?<Notice text={error} error/>:null}<Text style={s.label}>OU SAISIR LE CODE</Text><TextInput style={s.input} value={code} onChangeText={setCode} autoCapitalize="characters"/><GoldButton title="Rechercher le profil" onPress={()=>lookup()}/></View>
}

// Scanner d'entrée pour le personnel (ADMIN/ORGANIZER/RECEPTION) : distinct du Scanner ci-dessus, qui
// ne fait que consulter un profil de contact entre participants. Ici chaque scan valide directement
// le billet côté serveur (/admin/tickets/scan) — pas d'étape de confirmation séparée, voir Scanner()
// dans apps/web/src/App.tsx pour l'équivalent web.
function TicketScanner(){
  const [permission,requestPermission]=useCameraPermissions();
  const [active,setActive]=useState(false);
  const [code,setCode]=useState("");
  const [result,setResult]=useState<any>(null);
  const [error,setError]=useState("");
  const busyRef=useRef(false);
  const lastScanRef=useRef<{code:string;at:number}>({code:"",at:0});

  const runScan=async(scannedCode:string)=>{
    if(!scannedCode||busyRef.current)return;
    busyRef.current=true;setResult(null);setError("");
    try{setResult(await api<any>("/admin/tickets/scan",{method:"POST",body:JSON.stringify({code:scannedCode})}))}
    catch(e){setError((e as Error).message)}
    finally{busyRef.current=false}
  };
  const onBarcode=(data:string)=>{
    const now=Date.now();
    if(data===lastScanRef.current.code&&now-lastScanRef.current.at<3000)return;
    lastScanRef.current={code:data,at:now};
    runScan(data);
  };
  const open=async()=>{if(!permission?.granted){const p=await requestPermission();if(!p.granted){Alert.alert("Caméra refusée","Vous pouvez saisir le code manuellement.");return}}setActive(true)};
  const submitManual=()=>{runScan(code);setCode("")};

  return <View>
    <Text style={s.sectionTitle}>Scanner un billet</Text>
    {active?<View style={s.cameraWrap}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{barcodeTypes:["qr"]}} onBarcodeScanned={({data})=>onBarcode(data)}/><View style={s.scanGuide}/></View>
    :<Pressable onPress={open} style={s.scanPlaceholder}><Text style={s.scanIcon}>⌗</Text><Text style={s.sectionTitle}>Ouvrir la caméra</Text><Text style={s.meta}>Cadrez le QR code du billet.</Text></Pressable>}
    <View style={[s.reservationCard,result?{borderColor:C.green}:error?{borderColor:C.red}:null]}>
      {result?<><Text style={{color:C.green,fontWeight:"800",fontSize:18}}>✓ Entrée autorisée</Text><Text style={s.bodyStrong}>{result.participant}</Text><Text style={s.meta}>{result.event}</Text></>
      :error?<><Text style={{color:C.red,fontWeight:"800",fontSize:18}}>× Entrée refusée</Text><Text style={s.meta}>{error}</Text></>
      :<Text style={s.meta}>En attente d’un billet : présentez le QR code ou saisissez le code manuellement.</Text>}
    </View>
    <Text style={s.label}>SAISIE MANUELLE (SECOURS)</Text>
    <TextInput style={s.input} value={code} onChangeText={setCode} placeholder="Code du billet" placeholderTextColor="#666" autoCapitalize="characters"/>
    <GoldButton title="Vérifier et valider l’entrée" onPress={submitManual}/>
  </View>;
}

// Accueil du personnel sans fiche restaurant (ADMIN/MODERATOR/RECEPTION) : un compte ORGANIZER passe
// par RestaurantSpace à la place (voir plus haut), pas par cet écran, pour ne pas dupliquer sa fiche
// établissement ni son bouton de déconnexion. Le reste du back-office (statistiques, finance,
// modération, CMS…) reste volontairement hors mobile : ce sont des outils denses pensés desktop,
// contrairement au scan de billet à l'entrée qui, lui, a toute sa place sur un téléphone.
const ROLE_LABEL:Record<string,string>={ADMIN:"ADMINISTRATEUR",MODERATOR:"MODÉRATEUR",RECEPTION:"PERSONNEL D’ACCUEIL"};
function StaffHome({user,onLogout}:{user:any,onLogout:()=>void}){
  return <SafeAreaView style={s.safe}><StatusBar style="light"/><ScrollView contentContainerStyle={s.content}>
    <Logo/>
    <View style={s.loginHero}><Text style={s.eyebrow}>{ROLE_LABEL[user.role]??user.role}</Text><Text style={s.homeTitle}>Bonjour {user.displayName}.</Text></View>
    {user.role==="RECEPTION"||user.role==="ADMIN"?<TicketScanner/>:<Notice text="Utilisez le site nour-meet pour traiter les signalements de modération."/>}
    <Text style={[s.meta,{marginTop:24}]}>Le reste de l’administration (statistiques, finance, gestion des événements…) se gère depuis le site nour-meet.</Text>
    <GoldButton title="Se déconnecter" secondary onPress={onLogout}/>
  </ScrollView></SafeAreaView>;
}

function Messages({user}:{user:any}){
  const [convos,setConvos]=useState<any[]>([]),[active,setActive]=useState<any>(null),[messages,setMessages]=useState<any[]>([]),[body,setBody]=useState("");useEffect(()=>{api<any[]>("/conversations").then(setConvos)},[]);
  const other=(c:any)=>c.members.find((m:any)=>m.userId!==user.id)?.user;const open=async(c:any)=>{setActive(c);setMessages(await api(`/conversations/${c.id}/messages`))};const send=async()=>{if(!body.trim())return;const m=await api<any>(`/conversations/${active.id}/messages`,{method:"POST",body:JSON.stringify({body})});setMessages([...messages,m]);setBody("")};
  if(active)return <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":undefined}><View style={s.chatHead}><Pressable onPress={()=>setActive(null)}><Text style={s.back}>‹</Text></Pressable><Avatar name={other(active)?.displayName} photoUrl={other(active)?.profile?.photoUrl}/><View><Text style={s.bodyStrong}>{other(active)?.displayName}</Text><Text style={s.validated}>CONTACT ACCEPTÉ</Text></View></View><ScrollView contentContainerStyle={s.chatBody}>{messages.map(m=><View key={m.id} style={[s.bubble,m.senderId===user.id&&s.bubbleMine]}><Text style={s.bubbleText}>{m.body}</Text><Text style={s.bubbleTime}>{new Date(m.createdAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</Text></View>)}</ScrollView><View style={s.chatInput}><TextInput style={s.chatText} value={body} onChangeText={setBody} placeholder="Votre message…" placeholderTextColor="#777"/><Pressable onPress={send}><Text style={s.send}>Envoyer</Text></Pressable></View></KeyboardAvoidingView>;
  return <ScrollView contentContainerStyle={s.content}><ScreenTitle title="Messages"/><View style={s.tabs}><Text style={s.tabActive}>Tous</Text><Text style={s.tabText}>Non lus</Text></View>{convos.map(c=><Pressable style={s.conversation} onPress={()=>open(c)} key={c.id}><Avatar name={other(c)?.displayName??"?"} photoUrl={other(c)?.profile?.photoUrl}/><View style={{flex:1}}><Text style={s.bodyStrong}>{other(c)?.displayName}</Text><Text style={s.meta}>{c.messages[0]?.body??"Nouvelle conversation"}</Text></View><Text style={s.link}>›</Text></Pressable>)}</ScrollView>
}

// "Mon espace" (parité avec le dashboard participant du site web, voir Dashboard() dans
// apps/web/src/App.tsx) : un hub avec ses propres sous-onglets plutôt que cinq entrées de plus dans
// la barre de navigation globale (déjà pleine), la même structure que la sidebar web.
type EspaceTab="interview"|"reservations"|"tickets"|"profile"|"notifications";

function AltOfferCard({offer,busy,onRespond}:{offer:any,busy:boolean,onRespond:(accept:boolean)=>void}){
  return <View style={s.altOffer}>
    <Text style={s.eyebrow}>ÉVÉNEMENT ALTERNATIF PROPOSÉ</Text>
    <Text style={s.sectionTitle}>{offer.alternativeEvent.title}</Text>
    <Text style={s.meta}>{when(offer.alternativeEvent.startsAt)} · {offer.alternativeEvent.district}</Text>
    <Text style={s.bodyStrong}>{money(offer.alternativeEvent.priceCents)}</Text>
    <View style={{flexDirection:"row",gap:10,marginTop:10}}><View style={{flex:1}}><GoldButton title={busy?"…":"Accepter"} onPress={()=>onRespond(true)} disabled={busy}/></View><View style={{flex:1}}><GoldButton title={busy?"…":"Refuser"} secondary onPress={()=>onRespond(false)} disabled={busy}/></View></View>
  </View>;
}

function EspaceReservations({apps,offers,onChanged}:{apps:any[],offers:any[],onChanged:()=>void}){
  const [busyId,setBusyId]=useState<string|null>(null),[message,setMessage]=useState("");
  const pendingOffers=offers.filter(o=>o.status==="PENDING");
  const eventApps=apps.filter(a=>a.eventId);
  const cancelApplication=async(appId:string)=>{
    setBusyId(appId);setMessage("");
    try{const result=await api<{refunded:boolean;refundedAmountCents:number|null}>(`/me/applications/${appId}/cancel`,{method:"POST"});setMessage(result.refunded?`Candidature annulée. ${money(result.refundedAmountCents!)} remboursés.`:"Candidature annulée.");onChanged()}
    catch(e){setMessage((e as Error).message)}
    finally{setBusyId(null)}
  };
  const respondOffer=async(offerId:string,accept:boolean)=>{
    setBusyId(offerId);setMessage("");
    try{await api(`/alternative-offers/${offerId}/respond`,{method:"POST",body:JSON.stringify({accept})});setMessage(accept?"Place réservée : réglez votre billet depuis le site.":"Proposition refusée.");onChanged()}
    catch(e){setMessage((e as Error).message)}
    finally{setBusyId(null)}
  };
  return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle title="Mes événements"/>
    {message?<Notice text={message}/>:null}
    {eventApps.length===0?<Text style={s.meta}>Aucune inscription pour le moment.</Text>:eventApps.map(a=>{
      const offer=pendingOffers.find(o=>o.originalEventId===a.eventId);
      return <View key={a.id} style={s.reservationCard}>
        <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-start"}}><CategoryChip category={a.event.category}/><Text style={s.meta}>{APPLICATION_STATUS_LABEL[a.status]??a.status}</Text></View>
        <Text style={s.sectionTitle}>{a.event.title}</Text>
        <Text style={s.meta}>{when(a.event.startsAt)} · {a.event.district}</Text>
        {a.call&&a.status==="CALL_SCHEDULED"&&<Text style={s.meta}>Entretien : {when(a.call.startsAt)}</Text>}
        {offer&&<AltOfferCard offer={offer} busy={busyId===offer.id} onRespond={accept=>respondOffer(offer.id,accept)}/>}
        {!["REFUSED","CANCELLED"].includes(a.status)&&<GoldButton title={busyId===a.id?"…":"Annuler ma participation"} secondary disabled={busyId===a.id} onPress={()=>cancelApplication(a.id)}/>}
      </View>;
    })}
  </ScrollView>;
}

function EspaceTickets({tickets}:{tickets:any[]}){
  return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle title={tickets.length===1?"Mon billet":"Mes billets"}/>
    {tickets.length===0?<Text style={s.meta}>Aucun billet pour le moment.</Text>:tickets.map(t=>
      <View key={t.id} style={s.ticketCard}>
        <CategoryChip category={t.reservation.event.category}/>
        <Text style={[s.eyebrow,{marginTop:10}]}>{when(t.reservation.event.startsAt).toUpperCase()}</Text>
        <Text style={s.ticketTitle}>{t.reservation.event.title}</Text>
        {t.reservation.event.controllerRestaurant&&<Text style={s.meta}>{t.reservation.event.controllerRestaurant.name}</Text>}
        <Text style={s.meta}>{t.reservation.event.district}</Text>
        <Image source={{uri:t.qrDataUrl}} style={[s.qr,{backgroundColor:"#fff",borderRadius:8}]}/>
        <Text style={s.ticketCode}>{t.code}</Text>
      </View>
    )}
  </ScrollView>;
}

function EspaceNotifications({notifications}:{notifications:any[]}){
  return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle title="Notifications"/>
    {notifications.length===0?<Text style={s.meta}>Aucune notification.</Text>:notifications.map(n=>
      <View key={n.id} style={[s.notification,!n.readAt&&s.notificationUnread]}><Text style={s.bodyStrong}>{n.title}</Text><Text style={s.paragraph}>{n.body}</Text><Text style={s.meta}>{when(n.createdAt)}</Text></View>
    )}
  </ScrollView>;
}

function EspaceProfile({user,onSaved,onLogout}:{user:any,onSaved:()=>void,onLogout:()=>void}){
  const [form,setForm]=useState({displayName:user.displayName??"",email:user.email??"",city:user.profile?.city??"",profession:user.profile?.profession??"",interests:(user.profile?.interests??[]).join(", "),bio:user.profile?.bio??"",quotaCategory:user.profile?.quotaCategory??""});
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[photoBusy,setPhotoBusy]=useState(false);
  const [qr,setQr]=useState<any>(null),[loyalty,setLoyalty]=useState<any>(null);
  useEffect(()=>{api("/me/share-qr").then(setQr);api("/loyalty").then(setLoyalty)},[]);
  const save=async()=>{
    setBusy(true);setMessage("");
    try{await api("/me/profile",{method:"PATCH",body:JSON.stringify({...form,email:form.email||null,quotaCategory:form.quotaCategory||null,interests:form.interests.split(",").map((x:string)=>x.trim()).filter(Boolean)})});setMessage("Profil enregistré.");onSaved()}
    catch(e){setMessage((e as Error).message)}
    finally{setBusy(false)}
  };
  const pickPhoto=async()=>{
    const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(!permission.granted){Alert.alert("Accès refusé","Autorisez l’accès aux photos pour changer votre photo de profil.");return}
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:0.8});
    if(result.canceled||!result.assets[0])return;
    const asset=result.assets[0];
    setPhotoBusy(true);setMessage("");
    try{const body=new FormData();body.append("file",{uri:asset.uri,name:asset.fileName??"photo.jpg",type:asset.mimeType??"image/jpeg"} as any);await api("/me/profile-photo",{method:"POST",body});onSaved()}
    catch(e){setMessage((e as Error).message)}
    finally{setPhotoBusy(false)}
  };
  const removePhoto=async()=>{
    setPhotoBusy(true);setMessage("");
    try{await api("/me/profile-photo",{method:"DELETE"});onSaved()}
    catch(e){setMessage((e as Error).message)}
    finally{setPhotoBusy(false)}
  };
  return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle title="Mon profil"/>
    {message?<Notice text={message} error={!message.includes("enregistré")}/>:null}
    <View style={{alignItems:"center",marginVertical:14}}>
      <Avatar name={user.displayName} size={100} photoUrl={user.profile?.photoUrl}/>
      <View style={{flexDirection:"row",gap:16,marginTop:12}}>
        <Pressable onPress={pickPhoto} disabled={photoBusy}><Text style={s.link}>{photoBusy?"…":user.profile?.photoUrl?"Changer la photo":"Ajouter une photo"}</Text></Pressable>
        {user.profile?.photoUrl&&<Pressable onPress={removePhoto} disabled={photoBusy}><Text style={[s.link,{color:C.red}]}>Retirer</Text></Pressable>}
      </View>
    </View>
    <Text style={s.label}>PRÉNOM OU PSEUDONYME</Text><TextInput style={s.input} value={form.displayName} onChangeText={v=>setForm({...form,displayName:v})}/>
    <Text style={s.label}>E-MAIL</Text><TextInput style={s.input} value={form.email} onChangeText={v=>setForm({...form,email:v})} keyboardType="email-address" autoCapitalize="none"/>
    <Text style={s.label}>VILLE</Text><TextInput style={s.input} value={form.city} onChangeText={v=>setForm({...form,city:v})}/>
    <Text style={s.label}>PROFESSION</Text><TextInput style={s.input} value={form.profession} onChangeText={v=>setForm({...form,profession:v})}/>
    <Text style={s.label}>CENTRES D’INTÉRÊT</Text><TextInput style={s.input} value={form.interests} onChangeText={v=>setForm({...form,interests:v})} placeholder="Voyages, Art, Lecture" placeholderTextColor="#666"/>
    <Text style={s.label}>CATÉGORIE (ÉVÉNEMENTS AVEC QUOTAS)</Text>
    <View style={{flexDirection:"row",gap:10,marginBottom:8}}>{[["","Non renseignée"],["HOMME","Homme"],["FEMME","Femme"]].map(([value,label])=><Pressable key={value} onPress={()=>setForm({...form,quotaCategory:value})} style={[s.choiceChip,form.quotaCategory===value&&s.choiceChipActive]}><Text style={[s.choiceChipText,form.quotaCategory===value&&{color:"#111"}]}>{label}</Text></Pressable>)}</View>
    <Text style={s.label}>BIOGRAPHIE</Text><TextInput style={[s.input,{height:90}]} multiline value={form.bio} onChangeText={v=>setForm({...form,bio:v})}/>
    <GoldButton title={busy?"Enregistrement…":"Enregistrer"} onPress={save} disabled={busy}/>
    {qr&&<View style={s.personalQr}><Text style={s.eyebrow}>MON CODE PERSONNEL</Text><Image source={{uri:qr.qrDataUrl}} style={s.qr}/><Text style={s.qrCode}>{qr.code}</Text><Text style={[s.meta,{textAlign:"center"}]}>Le chat s’ouvre uniquement après votre acceptation.</Text></View>}
    {loyalty&&<Text style={[s.meta,{textAlign:"center",marginTop:10}]}>{loyalty.balance} points de fidélité</Text>}
    <GoldButton title="Se déconnecter" secondary onPress={onLogout}/>
  </ScrollView>;
}

function EspaceInterview({user}:{user:any}){
  const [status,setStatus]=useState<any>(undefined);
  const [motivation,setMotivation]=useState("");
  const [slots,setSlots]=useState<any[]>([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [activeDay,setActiveDay]=useState<string|null>(null);
  const [schedulingId,setSchedulingId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const load=()=>api<any>("/me/global-interview").then(setStatus).catch(()=>setStatus(null));
  useEffect(()=>{load()},[]);
  useEffect(()=>{
    if(!status||status.status!=="PENDING_CALL"||status.call){setSlots([]);return}
    setLoadingSlots(true);
    api<any[]>("/interview-slots").then(list=>{setSlots(list);const days=[...new Set(list.map(x=>new Date(x.startsAt).toDateString()))];setActiveDay(days[0]??null)}).catch(()=>setSlots([])).finally(()=>setLoadingSlots(false));
  },[status?.status,status?.call]);
  const request=async()=>{
    if(motivation.trim().length<30){setMessage("Expliquez votre motivation en au moins 30 caractères.");return}
    setBusy(true);setMessage("");
    try{await api("/me/global-interview",{method:"POST",body:JSON.stringify({motivation})});setMotivation("");await load()}
    catch(e){setMessage((e as Error).message)}
    finally{setBusy(false)}
  };
  const schedule=async(slotId:string)=>{
    setSchedulingId(slotId);setMessage("");
    try{const result=await api<any>(`/applications/${status.id}/schedule`,{method:"POST",body:JSON.stringify({slotId})});setStatus({...status,status:"CALL_SCHEDULED",call:result.slot});setMessage("Votre entretien est confirmé.")}
    catch(e){setMessage((e as Error).message);api<any[]>("/interview-slots").then(setSlots).catch(()=>{})}
    finally{setSchedulingId(null)}
  };
  const cancel=async()=>{
    setBusy(true);setMessage("");
    try{await api(`/me/applications/${status.id}/cancel`,{method:"POST"});await load()}
    catch(e){setMessage((e as Error).message)}
    finally{setBusy(false)}
  };
  const slotsByDay=useMemo(()=>{const map=new Map<string,any[]>();for(const slot of slots){const key=new Date(slot.startsAt).toDateString();if(!map.has(key))map.set(key,[]);map.get(key)!.push(slot)}return map},[slots]);
  if(status===undefined)return <View style={[s.content,{flex:1,alignItems:"center"}]}><ActivityIndicator color={C.gold}/></View>;
  const requestForm=<View><Text style={s.label}>VOTRE MOTIVATION</Text><TextInput style={[s.input,{height:90}]} multiline value={motivation} onChangeText={setMotivation} placeholder="Expliquez en quelques lignes ce que vous recherchez…" placeholderTextColor="#666"/><GoldButton title={busy?"Envoi…":"Demander mon entretien"} onPress={request} disabled={busy}/></View>;
  return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle eyebrow="OBLIGATOIRE AVANT DE S’INSCRIRE À UN SPEED DATING" title="Entretien de validation"/>
    {message?<Notice text={message} error={!message.includes("confirmé")&&!message.includes("annulée")}/>:null}
    {user.profile?.validatedAt?<Notice text="Votre profil est validé : vous pouvez vous inscrire directement aux événements."/>
    :!status||status.status==null?requestForm
    :status.status==="REFUSED"?(
      status.retryAvailableAt&&new Date(status.retryAvailableAt)>new Date()
        ?<><Notice text={`Votre profil n’a pas été validé${status.notes?` : ${status.notes}`:"."}`} error/><Text style={s.meta}>Vous pourrez redemander un entretien à partir du {new Date(status.retryAvailableAt).toLocaleDateString("fr-FR")}.</Text></>
        :<>{status.notes&&<Notice text={status.notes} error/>}{requestForm}</>
    )
    :status.status==="PENDING_CALL"&&!status.call?<View>
      {loadingSlots?<ActivityIndicator color={C.gold}/>
      :slots.length===0?<Text style={s.meta}>Aucun créneau disponible pour le moment.</Text>
      :<View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:12}}>{[...slotsByDay.keys()].map(day=><Pressable key={day} onPress={()=>setActiveDay(day)} style={[s.choiceChip,activeDay===day&&s.choiceChipActive,{marginRight:8}]}><Text style={[s.choiceChipText,activeDay===day&&{color:"#111"}]}>{dayLabel(day)}</Text></Pressable>)}</ScrollView><View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{(slotsByDay.get(activeDay??"")??[]).map(slot=><Pressable key={slot.id} disabled={schedulingId===slot.id} onPress={()=>schedule(slot.id)} style={s.choiceChip}><Text style={s.choiceChipText}>{schedulingId===slot.id?"…":timeLabel(slot.startsAt)}</Text></Pressable>)}</View></View>}
      <GoldButton title={busy?"…":"Annuler ma demande"} secondary onPress={cancel} disabled={busy}/>
    </View>
    :status.call?<View style={s.reservationCard}><Text style={s.eyebrow}>ENTRETIEN PROGRAMMÉ</Text><Text style={s.sectionTitle}>{when(status.call.startsAt)}</Text><Text style={s.paragraph}>Nour Meet vous appellera à cette heure, puis vous serez informé(e) de la décision.</Text><GoldButton title={busy?"…":"Annuler"} secondary onPress={cancel} disabled={busy}/></View>
    :null}
  </ScrollView>;
}

function Espace({user,onSaved,onLogout}:{user:any,onSaved:()=>void,onLogout:()=>void}){
  const [tab,setTab]=useState<EspaceTab>("reservations");
  const [apps,setApps]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]),[notifications,setNotifications]=useState<any[]>([]),[offers,setOffers]=useState<any[]>([]);
  const load=()=>Promise.all([api<any[]>("/me/applications"),api<any[]>("/me/tickets"),api<any[]>("/notifications"),api<any[]>("/me/alternative-offers")]).then(([a,t,n,o])=>{setApps(a);setTickets(t);setNotifications(n);setOffers(o)});
  useEffect(()=>{load()},[]);
  const ticketsLabel=tickets.length===1?"Mon billet":"Mes billets";
  const tabs:[EspaceTab,string][]=[["interview",user.profile?.validatedAt?"Entretien ✓":"Entretien"],["reservations","Réservations"],["tickets",ticketsLabel],["profile","Profil"],["notifications","Notifications"]];
  return <View style={{flex:1}}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.espaceTabs} contentContainerStyle={{paddingHorizontal:20,gap:10}}>
      {tabs.map(([id,label])=><Pressable key={id} onPress={()=>setTab(id)} style={[s.choiceChip,tab===id&&s.choiceChipActive]}><Text style={[s.choiceChipText,tab===id&&{color:"#111"}]}>{label}</Text></Pressable>)}
    </ScrollView>
    {tab==="interview"&&<EspaceInterview user={user}/>}
    {tab==="reservations"&&<EspaceReservations apps={apps} offers={offers} onChanged={load}/>}
    {tab==="tickets"&&<EspaceTickets tickets={tickets}/>}
    {tab==="profile"&&<EspaceProfile user={user} onSaved={onSaved} onLogout={onLogout}/>}
    {tab==="notifications"&&<EspaceNotifications notifications={notifications}/>}
  </View>;
}

// Espace dédié aux comptes restaurateurs (candidature en cours ou déjà approuvée), voir
// RestaurantSpace/RestaurantApplication dans apps/web/src/App.tsx pour l'équivalent web : plus un
// onglet du dashboard participant, car un restaurateur n'a plus le droit d'y participer aux
// événements — seulement de les consulter. Remplace l'onglet "Mon espace" par "Mon établissement".
const emptyRestaurantForm={name:"",managerName:"",siret:"",description:"",district:"",address:"",phone:"",desiredCapacity:"",desiredSchedule:"",averagePricePerPersonCents:"",defaultMinParticipants:"",priceIncludesDrink:false,priceIncludesStarter:false,priceIncludesMain:false,priceIncludesDessert:false,priceNotes:"",proposesCategoryPricing:false,allowsPrivatization:false,specialConditions:""};
function ToggleChip({label,active,onPress}:{label:string,active:boolean,onPress:()=>void}){return <Pressable onPress={onPress} style={[s.choiceChip,active&&s.choiceChipActive]}><Text style={[s.choiceChipText,active&&{color:"#111"}]}>{label}</Text></Pressable>}

function RestaurantSpace({onLogout}:{onLogout:()=>void}){
  const [restaurant,setRestaurant]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState(emptyRestaurantForm);
  const [message,setMessage]=useState(""),[submitting,setSubmitting]=useState(false),[photoBusy,setPhotoBusy]=useState(false);

  const load=()=>api<any>("/restaurants/me").then(r=>{setRestaurant(r);setForm({...emptyRestaurantForm,name:r.name??"",managerName:r.managerName??"",siret:r.siret??"",description:r.description??"",district:r.district??"",address:r.address??"",phone:r.phone??"",desiredCapacity:r.desiredCapacity?String(r.desiredCapacity):"",desiredSchedule:r.desiredSchedule??"",averagePricePerPersonCents:r.averagePricePerPersonCents!=null?String(r.averagePricePerPersonCents/100):"",defaultMinParticipants:r.defaultMinParticipants?String(r.defaultMinParticipants):"",priceIncludesDrink:!!r.priceIncludesDrink,priceIncludesStarter:!!r.priceIncludesStarter,priceIncludesMain:!!r.priceIncludesMain,priceIncludesDessert:!!r.priceIncludesDessert,priceNotes:r.priceNotes??"",proposesCategoryPricing:!!r.proposesCategoryPricing,allowsPrivatization:!!r.allowsPrivatization,specialConditions:r.specialConditions??""})}).catch(()=>setRestaurant(null)).finally(()=>setLoading(false));
  useEffect(()=>{load()},[]);

  const payload=()=>({...form,desiredCapacity:form.desiredCapacity?Number(form.desiredCapacity):undefined,defaultMinParticipants:form.defaultMinParticipants?Number(form.defaultMinParticipants):undefined,averagePricePerPersonCents:form.averagePricePerPersonCents?Math.round(Number(form.averagePricePerPersonCents)*100):undefined});

  const submit=async()=>{
    if(!form.name.trim()||!form.managerName.trim()||!/^\d{14}$/.test(form.siret)){setMessage("Renseignez le nom, le responsable et un SIRET à 14 chiffres.");return}
    setSubmitting(true);setMessage("");
    try{await api("/restaurants/apply",{method:"POST",body:JSON.stringify(payload())});setMessage("Votre demande a été envoyée.");await load()}
    catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const saveProfile=async()=>{
    setSubmitting(true);setMessage("");
    try{await api("/restaurants/me",{method:"PATCH",body:JSON.stringify(payload())});setMessage("Fiche mise à jour.");await load()}
    catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const uploadPhoto=async()=>{
    const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(!permission.granted){Alert.alert("Accès refusé","Autorisez l’accès aux photos pour ajouter une photo.");return}
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:0.8});
    if(result.canceled||!result.assets[0])return;
    const asset=result.assets[0];
    setPhotoBusy(true);setMessage("");
    try{const body=new FormData();body.append("file",{uri:asset.uri,name:asset.fileName??"photo.jpg",type:asset.mimeType??"image/jpeg"} as any);await api("/restaurants/me/photos",{method:"POST",body});await load()}
    catch(e){setMessage((e as Error).message)}
    finally{setPhotoBusy(false)}
  };
  const removePhoto=async(photoId:string)=>{
    setPhotoBusy(true);setMessage("");
    try{await api(`/restaurants/me/photos/${photoId}`,{method:"DELETE"});await load()}
    catch(e){setMessage((e as Error).message)}
    finally{setPhotoBusy(false)}
  };

  const priceFields=<>
    <Text style={s.label}>PLACES POUR LA SOIRÉE</Text><TextInput style={s.input} keyboardType="number-pad" value={form.desiredCapacity} onChangeText={v=>setForm({...form,desiredCapacity:v.replace(/\D/g,"")})}/>
    <Text style={s.label}>JOURS ET HORAIRES SOUHAITÉS</Text><TextInput style={s.input} value={form.desiredSchedule} onChangeText={v=>setForm({...form,desiredSchedule:v})} placeholder="Vendredi et samedi soir" placeholderTextColor="#666"/>
    <Text style={s.label}>PRIX MOYEN PAR PERSONNE (€)</Text><TextInput style={s.input} keyboardType="decimal-pad" value={form.averagePricePerPersonCents} onChangeText={v=>setForm({...form,averagePricePerPersonCents:v.replace(/[^0-9.]/g,"")})}/>
    <Text style={s.label}>MINIMUM DE PARTICIPANTS HABITUEL</Text><TextInput style={s.input} keyboardType="number-pad" value={form.defaultMinParticipants} onChangeText={v=>setForm({...form,defaultMinParticipants:v.replace(/\D/g,"")})}/>
    <Text style={s.label}>LE PRIX COMPREND HABITUELLEMENT</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:8}}>
      <ToggleChip label="Boisson" active={form.priceIncludesDrink} onPress={()=>setForm({...form,priceIncludesDrink:!form.priceIncludesDrink})}/>
      <ToggleChip label="Entrée" active={form.priceIncludesStarter} onPress={()=>setForm({...form,priceIncludesStarter:!form.priceIncludesStarter})}/>
      <ToggleChip label="Plat" active={form.priceIncludesMain} onPress={()=>setForm({...form,priceIncludesMain:!form.priceIncludesMain})}/>
      <ToggleChip label="Dessert" active={form.priceIncludesDessert} onPress={()=>setForm({...form,priceIncludesDessert:!form.priceIncludesDessert})}/>
    </View>
    <Text style={s.label}>PRÉCISIONS SUR LE CONTENU DU PRIX</Text><TextInput style={[s.input,{height:70}]} multiline value={form.priceNotes} onChangeText={v=>setForm({...form,priceNotes:v})}/>
    <View style={{gap:8,marginBottom:8}}>
      <ToggleChip label="Tarifs par catégorie (homme/femme)" active={form.proposesCategoryPricing} onPress={()=>setForm({...form,proposesCategoryPricing:!form.proposesCategoryPricing})}/>
      <ToggleChip label="Privatisation possible" active={form.allowsPrivatization} onPress={()=>setForm({...form,allowsPrivatization:!form.allowsPrivatization})}/>
    </View>
    <Text style={s.label}>CONDITIONS PARTICULIÈRES</Text><TextInput style={[s.input,{height:70}]} multiline value={form.specialConditions} onChangeText={v=>setForm({...form,specialConditions:v})}/>
  </>;

  if(loading)return <View style={[s.content,{flex:1,alignItems:"center"}]}><ActivityIndicator color={C.gold}/></View>;

  if(restaurant?.status==="PENDING")return <ScrollView contentContainerStyle={s.content}><ScreenTitle title="Mon établissement"/><Notice text={`Votre demande pour « ${restaurant.name} » est en cours d’examen.`}/><GoldButton title="Se déconnecter" secondary onPress={onLogout}/></ScrollView>;

  if(restaurant?.status==="APPROVED")return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle title="Mon établissement"/>
    <Notice text={`Votre établissement « ${restaurant.name} » est approuvé.`}/>
    {message?<Notice text={message} error={!message.includes("mise à jour")}/>:null}
    <Text style={s.sectionTitle}>Fiche établissement</Text>
    {priceFields}
    <GoldButton title={submitting?"Enregistrement…":"Enregistrer"} onPress={saveProfile} disabled={submitting}/>
    <Text style={[s.sectionTitle,{marginTop:24}]}>Galerie ({(restaurant.photos??[]).length}/8)</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:10,marginBottom:14}}>
      {(restaurant.photos??[]).map((p:any)=><View key={p.id} style={{width:100}}><Image source={{uri:`${API_URL}${p.url}`}} style={{width:100,height:100,borderRadius:8}}/><Pressable onPress={()=>removePhoto(p.id)} disabled={photoBusy}><Text style={[s.link,{marginTop:4,textAlign:"center"}]}>Retirer</Text></Pressable></View>)}
    </View>
    <GoldButton title={photoBusy?"…":"Ajouter une photo"} secondary onPress={uploadPhoto} disabled={photoBusy||(restaurant.photos??[]).length>=8}/>
    <View style={{marginTop:30}}><TicketScanner/></View>
    <Text style={[s.meta,{marginTop:20}]}>La gestion des événements et du tableau de bord se fait pour l’instant depuis le site nour-meet.</Text>
    <GoldButton title="Se déconnecter" secondary onPress={onLogout}/>
  </ScrollView>;

  return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle eyebrow="OUVRIR UN COMPTE PROFESSIONNEL" title="Devenir restaurateur"/>
    {restaurant?.status==="REJECTED"&&<Notice text={`Votre précédente demande n’a pas été retenue${restaurant.rejectionReason?` : ${restaurant.rejectionReason}`:"."} Vous pouvez soumettre une nouvelle demande.`} error/>}
    {message?<Notice text={message} error={!message.includes("envoyée")}/>:null}
    <Text style={s.label}>NOM DE L’ÉTABLISSEMENT</Text><TextInput style={s.input} value={form.name} onChangeText={v=>setForm({...form,name:v})}/>
    <Text style={s.label}>NOM DU RESPONSABLE</Text><TextInput style={s.input} value={form.managerName} onChangeText={v=>setForm({...form,managerName:v})}/>
    <Text style={s.label}>SIRET (14 CHIFFRES)</Text><TextInput style={s.input} keyboardType="number-pad" value={form.siret} onChangeText={v=>setForm({...form,siret:v.replace(/\D/g,"").slice(0,14)})}/>
    <Text style={s.label}>TÉLÉPHONE PROFESSIONNEL</Text><TextInput style={s.input} keyboardType="phone-pad" value={form.phone} onChangeText={v=>setForm({...form,phone:v})}/>
    <Text style={s.label}>QUARTIER / VILLE</Text><TextInput style={s.input} value={form.district} onChangeText={v=>setForm({...form,district:v})}/>
    <Text style={s.label}>ADRESSE</Text><TextInput style={s.input} value={form.address} onChangeText={v=>setForm({...form,address:v})}/>
    <Text style={s.label}>DESCRIPTION</Text><TextInput style={[s.input,{height:80}]} multiline value={form.description} onChangeText={v=>setForm({...form,description:v})}/>
    {priceFields}
    <Text style={[s.meta,{marginVertical:12}]}>Le SIRET est déclaratif : Nour ne réalise pas de vérification officielle auprès d’un registre. La galerie de photos se complète après approbation.</Text>
    <GoldButton title={submitting?"Envoi…":"Envoyer ma demande"} onPress={submit} disabled={submitting}/>
    <GoldButton title="Se déconnecter" secondary onPress={onLogout}/>
  </ScrollView>;
}

function TabBar({tab,setTab,profileLabel}:{tab:Tab,setTab:(t:Tab)=>void,profileLabel:string}){const tabs:[Tab,string,string][]=[["home","⌂","Accueil"],["events","◇","Événements"],["scan","⌗","Scanner"],["messages","○","Messages"],["profile","●",profileLabel]];return <View style={s.tabBar}>{tabs.map(([id,icon,label])=><Pressable key={id} onPress={()=>setTab(id)} style={[s.tabItem,id==="scan"&&s.scanTab]}><Text style={[s.tabIcon,tab===id&&{color:id==="scan"?"#111":C.gold}]}>{icon}</Text><Text style={[s.tabLabel,tab===id&&{color:C.gold}]}>{label}</Text></Pressable>)}</View>}

export default function App(){
  const [loading,setLoading]=useState(true),[user,setUser]=useState<any>(null),[tab,setTab]=useState<Tab>("home");
  // Vrai dès que le choix "restaurateur" a été fait au premier login (voir Login) ET tant que la
  // fiche Restaurant n'existe pas encore côté serveur : sans ça, un tout nouveau candidat n'aurait
  // aucun moyen d'atterrir sur le formulaire, puisque user.hasRestaurant reste faux jusqu'à l'envoi
  // de sa demande (même logique que le navigate("/restaurant") du web, voir Login() sur le web).
  const [forceRestaurantSpace,setForceRestaurantSpace]=useState(false);
  const load=async()=>{setLoading(true);try{if(await getToken())setUser(await api("/me"));else setUser(null)}catch{await setToken(null);setUser(null)}finally{setLoading(false)}};useEffect(()=>{load()},[]);
  const logout=async()=>{await setToken(null);setUser(null);setForceRestaurantSpace(false)};
  if(loading)return <SafeAreaView style={[s.safe,s.center]}><ActivityIndicator color={C.gold}/></SafeAreaView>;
  if(!user)return <Login onLogin={opts=>{if(opts?.restaurateur){setForceRestaurantSpace(true);setTab("profile")}load()}}/>;
  if(["ADMIN","MODERATOR","RECEPTION"].includes(user.role))return <StaffHome user={user} onLogout={logout}/>;
  const showRestaurantSpace=user.hasRestaurant||forceRestaurantSpace;
  return <SafeAreaView style={s.safe}><StatusBar style="light"/><View style={s.app}>{tab==="home"&&<Home user={user} setTab={setTab}/>} {tab==="events"&&<Events user={user}/>}{tab==="concept"&&<Concept setTab={setTab}/>}{tab==="blog"&&<Blog setTab={setTab}/>}{tab==="scan"&&<Scanner/>}{tab==="messages"&&<Messages user={user}/>} {tab==="profile"&&(showRestaurantSpace?<RestaurantSpace onLogout={logout}/>:<Espace user={user} onSaved={load} onLogout={logout}/>)}</View><TabBar tab={tab} setTab={setTab} profileLabel={showRestaurantSpace?"Mon établissement":"Mon espace"}/></SafeAreaView>
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},app:{flex:1,paddingBottom:74},center:{alignItems:"center",justifyContent:"center"},content:{padding:20,paddingBottom:40},logo:{flexDirection:"row",alignItems:"center",gap:10},logoMark:{width:38,height:38,borderRadius:19,borderWidth:1,borderColor:C.gold,alignItems:"center",justifyContent:"center"},logoN:{color:C.gold,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:22},logoText:{color:C.cream,fontWeight:"700",letterSpacing:2},login:{flex:1,padding:26,justifyContent:"space-between"},loginHero:{marginTop:70},eyebrow:{color:C.gold,fontWeight:"800",fontSize:10,letterSpacing:1.2},loginTitle:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:39,lineHeight:44,marginTop:14},paragraph:{color:C.muted,fontSize:15,lineHeight:23},label:{color:C.muted,fontWeight:"700",fontSize:10,letterSpacing:1,marginTop:15,marginBottom:7},input:{backgroundColor:"#121213",borderWidth:1,borderColor:C.line,borderRadius:8,color:C.cream,paddingHorizontal:15,height:52},otp:{fontSize:25,letterSpacing:9,textAlign:"center"},button:{minHeight:50,backgroundColor:C.gold,borderRadius:8,alignItems:"center",justifyContent:"center",paddingHorizontal:17,marginVertical:6},buttonSecondary:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line},buttonText:{color:"#111",fontWeight:"900"},notice:{borderLeftWidth:3,borderLeftColor:C.green,backgroundColor:C.panel,padding:13,borderRadius:6,marginVertical:9},noticeText:{color:C.cream,fontSize:13},demo:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:8,padding:14,marginTop:12,gap:4},demoTitle:{color:C.gold,fontWeight:"800",fontSize:10},meta:{color:C.muted,fontSize:12},titleRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-end",marginBottom:18},screenTitle:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:30,marginTop:4},hello:{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-start",marginTop:10},homeTitle:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:30,lineHeight:35,marginTop:9},avatar:{backgroundColor:"#A37D40",alignItems:"center",justifyContent:"center"},avatarText:{color:"#111",fontWeight:"900"},ticketMini:{backgroundColor:"#251C10",borderColor:"#705833",borderWidth:1,borderRadius:11,padding:17,marginVertical:25,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},ticketTitle:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:20,marginVertical:6},miniQr:{width:80,height:80,borderRadius:5},link:{color:C.gold,fontSize:13,fontWeight:"700"},eventCard:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:11,overflow:"hidden",flexDirection:"row",minHeight:145,marginBottom:13},eventArt:{width:125,backgroundColor:"#392B18",alignItems:"center",justifyContent:"center"},eventDay:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:38},eventMonth:{color:C.gold,fontWeight:"800",fontSize:10},eventCopy:{flex:1,padding:15},eventTitle:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:18,marginVertical:8},price:{color:C.cream,fontWeight:"800",marginTop:10},chips:{flexDirection:"row",flexWrap:"wrap",gap:8,marginVertical:10},chip:{color:C.cream,backgroundColor:"#232325",paddingHorizontal:12,paddingVertical:8,borderRadius:18,fontSize:11},chipGold:{color:C.gold,backgroundColor:"#302719",paddingHorizontal:12,paddingVertical:8,borderRadius:18,fontSize:11,fontWeight:"800"},search:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:8,color:C.cream,padding:13,marginBottom:18},back:{color:C.cream,fontSize:17,marginVertical:14},detailArt:{height:300,backgroundColor:"#3A2B18",borderColor:"#745B35",borderWidth:1,borderRadius:13,justifyContent:"flex-end",padding:24},detailTitle:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:37,marginTop:10},detailFacts:{flexDirection:"row",gap:30,borderBottomColor:C.line,borderBottomWidth:1,paddingVertical:22},bodyStrong:{color:C.cream,fontWeight:"700",fontSize:14},sectionTitle:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:22,marginTop:22,marginBottom:8},bookingBar:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:10,padding:13,flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:25},bookingPrice:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:22},cameraWrap:{height:480,borderRadius:14,overflow:"hidden",marginBottom:15},scanGuide:{position:"absolute",width:240,height:240,borderWidth:3,borderColor:C.gold,top:120,left:"50%",marginLeft:-120},scanPlaceholder:{height:380,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:12,alignItems:"center",justifyContent:"center",marginBottom:15},scanIcon:{color:C.gold,fontSize:70},profilePreview:{alignItems:"center",paddingVertical:25},profileName:{color:C.cream,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:30,marginTop:12},validated:{color:C.green,fontWeight:"800",fontSize:9,letterSpacing:1,marginTop:7},tabs:{flexDirection:"row",gap:28,borderBottomWidth:1,borderBottomColor:C.line,marginBottom:5},tabActive:{color:C.cream,borderBottomWidth:2,borderBottomColor:C.gold,paddingVertical:12,fontWeight:"700"},tabText:{color:C.muted,paddingVertical:12},conversation:{flexDirection:"row",alignItems:"center",gap:12,paddingVertical:14,borderBottomWidth:1,borderBottomColor:C.line},chatHead:{height:76,flexDirection:"row",alignItems:"center",gap:12,paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:C.line},chatBody:{padding:16,gap:9},bubble:{alignSelf:"flex-start",maxWidth:"80%",backgroundColor:"#242426",padding:12,borderRadius:13},bubbleMine:{alignSelf:"flex-end",backgroundColor:"#5A4729"},bubbleText:{color:C.cream,fontSize:14,lineHeight:20},bubbleTime:{color:"#AAA",fontSize:8,textAlign:"right",marginTop:5},chatInput:{flexDirection:"row",alignItems:"center",padding:10,borderTopWidth:1,borderTopColor:C.line,gap:10},chatText:{flex:1,backgroundColor:"#242426",color:C.cream,borderRadius:22,paddingHorizontal:15,height:44},send:{color:C.gold,fontWeight:"800"},profileStats:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:9,flexDirection:"row",justifyContent:"space-around",padding:16},statValue:{color:C.gold,fontFamily:Platform.OS==="ios"?"Georgia":"serif",fontSize:23,textAlign:"center"},personalQr:{backgroundColor:"#F3EBDD",borderRadius:13,padding:20,alignItems:"center",marginTop:20},qr:{width:210,height:210,margin:18},qrCode:{color:"#111",fontWeight:"800",fontFamily:Platform.OS==="ios"?"Menlo":"monospace"},tabBar:{height:78,position:"absolute",bottom:0,left:0,right:0,backgroundColor:"#111113",borderTopWidth:1,borderTopColor:C.line,flexDirection:"row",paddingBottom:8},tabItem:{flex:1,alignItems:"center",justifyContent:"center",gap:4},scanTab:{backgroundColor:C.gold,borderRadius:30,width:56,height:56,flex:0,marginHorizontal:9,marginTop:-14},tabIcon:{color:C.muted,fontSize:22},tabLabel:{color:C.muted,fontSize:8},
  categoryChip:{flexDirection:"row",alignItems:"center",gap:6},categoryDot:{width:8,height:8,borderRadius:4},categoryChipText:{fontSize:11,fontWeight:"800",letterSpacing:.5,textTransform:"uppercase"},
  espaceTabs:{flexGrow:0,marginBottom:16,marginTop:6},
  choiceChip:{borderWidth:1,borderColor:C.line,borderRadius:18,paddingHorizontal:16,paddingVertical:9,backgroundColor:C.panel},choiceChipActive:{backgroundColor:C.gold,borderColor:C.gold},choiceChipText:{color:C.cream,fontSize:12,fontWeight:"700"},
  reservationCard:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:11,padding:16,marginBottom:14,gap:4},
  ticketCard:{backgroundColor:"#251C10",borderColor:"#705833",borderWidth:1,borderRadius:13,padding:20,marginBottom:16,alignItems:"center"},
  ticketCode:{color:C.gold,fontWeight:"800",fontFamily:Platform.OS==="ios"?"Menlo":"monospace",marginTop:4},
  altOffer:{backgroundColor:"#171310",borderColor:"#5A482F",borderWidth:1,borderRadius:9,padding:14,marginVertical:10},
  notification:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:9,padding:14,marginBottom:10},notificationUnread:{borderColor:C.gold}
});
