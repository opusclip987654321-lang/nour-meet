import { EVENT_CATEGORIES, NETWORKING_QUESTIONS, SCREENING_QUESTIONS, eventRequiresScreening } from "@nour/shared";
import { useEffect, useState } from "react";
import { Image, ImageBackground, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { ConsentCheck, EventCard, GoldButton, Notice, ScreenTitle, availabilityLabel, legalLink } from "../components/ui";
import { categoryColor, imgUrl, money, when } from "../format";
import { payByCard } from "../payment";
import { s } from "../theme";

export function Events({user,initialCategory}:{user:any,initialCategory?:string}){
  const [events,setEvents]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[application,setApplication]=useState<any>(null),[message,setMessage]=useState(""),[showForm,setShowForm]=useState(false),[answers,setAnswers]=useState<Record<string,string>>({}),[submitting,setSubmitting]=useState(false);
  // Arbitrage 12/E3 (cahier des charges consolidé 2026-09-20) : formulaire professionnel facultatif
  // proposé une fois la place confirmée, jamais avant/pendant le paiement.
  const [netAnswers,setNetAnswers]=useState<Record<string,string>>({}),[netDone,setNetDone]=useState(false),[netDismissed,setNetDismissed]=useState(false);
  const [acceptCgv,setAcceptCgv]=useState(false);
  const [waitlistEntry,setWaitlistEntry]=useState<any>(null),[altOffer,setAltOffer]=useState<any>(null);
  // §5 (cahier des charges 2026-09) : un lien depuis le blog (ex. « nos soirées speed dating »)
  // arrive ici déjà filtré sur la bonne catégorie, voir App() et Blog() plus bas.
  const [q,setQ]=useState(""),[category,setCategory]=useState(initialCategory??"");
  useEffect(()=>{const params=new URLSearchParams({...(q?{q}:{}),...(category?{category}:{})});api<{items:any[]}>(`/events?${params}`).then(r=>setEvents(r.items))},[q,category]);
  const loadApplication=(eventId:string)=>api<any>(`/events/${eventId}/my-application`).then(setApplication).catch(()=>setApplication(null));
  const loadWaitlist=(eventId:string)=>api<any>(`/events/${eventId}/waitlist/me`).then(setWaitlistEntry).catch(()=>setWaitlistEntry(null));
  const openEvent=(e:any)=>{
    setSelected(e);setMessage("");setShowForm(false);setAcceptCgv(false);setAnswers({});setNetAnswers({});setNetDone(false);setNetDismissed(false);
    loadApplication(e.id);loadWaitlist(e.id);
    api<any[]>("/me/alternative-offers").then(list=>setAltOffer(list.find(o=>o.originalEventId===e.id&&o.status==="PENDING")??null)).catch(()=>{});
  };
  const requiresScreening=selected?eventRequiresScreening(selected):false;
  const questions=requiresScreening?SCREENING_QUESTIONS:NETWORKING_QUESTIONS;
  const full=selected?(selected.availability.kind!=="unknown"&&selected.availability.full):false;
  const categoryUnknown=selected?selected.availability.kind==="unknown":false;
  const canCancel=application&&!["REFUSED","CANCELLED"].includes(application.status);
  // La candidature ne garantit jamais de place (elle enregistre le questionnaire et autorise
  // seulement à tenter le paiement) : c'est le clic sur "Payer par carte" ci-dessous qui pose
  // réellement le verrou de réservation, pas cet envoi.
  const apply=async()=>{
    setSubmitting(true);
    try{
      const body=requiresScreening?{screeningAnswers:answers}:{};
      const result=await api<any>(`/events/${selected.id}/apply`,{method:"POST",body:JSON.stringify(body)});
      setApplication(result.application);
      setMessage("Candidature envoyée. Vous pouvez régler votre billet ci-dessous.");
      setShowForm(false);
    }catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  // CGV A3 : acceptation obligatoire avant de confirmer une place gratuite (le paiement par carte
  // la demande lui-même, dans la page web ouverte par payByCard).
  const confirmFree=async()=>{
    if(!acceptCgv){setMessage("Vous devez accepter les conditions générales de vente avant de réserver.");return}
    setSubmitting(true);
    try{
      const result=await api<{free:boolean;confirmed:boolean}>(`/applications/${application.id}/payment-intent`,{method:"POST",body:JSON.stringify({acceptCgv:true})});
      setMessage(result.confirmed?"Votre billet gratuit est confirmé.":"Votre place a déjà été confirmée.");
      await loadApplication(selected.id);
    }catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const submitNetworkingFollowUp=async()=>{
    setSubmitting(true);
    try{await api(`/applications/${application.id}/networking-answers`,{method:"POST",body:JSON.stringify(netAnswers)});setNetDone(true)}
    catch(e){setMessage((e as Error).message)}
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
    try{await api(`/events/${selected.id}/waitlist`,{method:"POST"});await loadWaitlist(selected.id);setMessage("Vous êtes inscrit(e) sur la liste d’attente.")}
    catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const leaveWaitlist=async()=>{
    setSubmitting(true);
    try{await api(`/events/${selected.id}/waitlist`,{method:"DELETE"});setWaitlistEntry(null);setMessage("Vous avez quitté la liste d’attente.")}
    catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const respondAltOffer=async(accept:boolean)=>{
    if(!altOffer)return;
    setSubmitting(true);
    try{await api(`/alternative-offers/${altOffer.id}/respond`,{method:"POST",body:JSON.stringify({accept})});setAltOffer(null);setMessage(accept?"Place réservée sur l’événement alternatif : consultez votre espace personnel pour payer.":"Proposition refusée.")}
    catch(e){setMessage((e as Error).message)}
    finally{setSubmitting(false)}
  };
  const share=async()=>{
    try{
      const link=await api<{url:string}>(`/events/${selected.id}/share-link`,{method:"POST"});
      await Share.share({message:`« ${selected.title} » sur Nūr Meet : ${link.url}`});
    }catch(e){setMessage((e as Error).message)}
  };
  if(selected){
    const perkLabels=[selected.perks?.drink&&"Boisson incluse",selected.perks?.starter&&"Entrée incluse",selected.perks?.main&&"Plat inclus",selected.perks?.dessert&&"Dessert inclus"].filter(Boolean) as string[];
    return <ScrollView contentContainerStyle={s.content}><Pressable onPress={()=>{setSelected(null);setApplication(null);setWaitlistEntry(null);setAltOffer(null)}}><Text style={s.back}>‹ Retour</Text></Pressable>
    {selected.imageUrl?<ImageBackground source={{uri:imgUrl(selected.imageUrl)}} style={s.detailArt} imageStyle={{borderRadius:13}}><View style={[StyleSheet.absoluteFill,{backgroundColor:"#0b0b0c99",borderRadius:13}]}/><Text style={[s.eyebrow,{color:categoryColor(selected.category)}]}>{selected.category.toUpperCase()}</Text><Text style={s.detailTitle}>{selected.title}</Text></ImageBackground>
    :<View style={s.detailArt}><Text style={[s.eyebrow,{color:categoryColor(selected.category)}]}>{selected.category.toUpperCase()}</Text><Text style={s.detailTitle}>{selected.title}</Text></View>}
    <Text style={s.paragraph}>{selected.description}</Text>
    {selected.photos?.length>0&&<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginVertical:14}} contentContainerStyle={{gap:10}}>{selected.photos.map((url:string,i:number)=><Image key={i} source={{uri:imgUrl(url)}} style={{width:220,height:140,borderRadius:10}}/>)}</ScrollView>}
    <View style={s.detailFacts}><View><Text style={s.label}>DATE</Text><Text style={s.bodyStrong}>{when(selected.startsAt)}</Text></View><View><Text style={s.label}>LIEU</Text><Text style={s.bodyStrong}>{selected.district}</Text></View></View>
    <View style={s.detailFacts}><View><Text style={s.label}>DISPONIBILITÉ</Text><Text style={s.bodyStrong}>{availabilityLabel(selected.availability)}</Text></View>{(selected.minAge||selected.maxAge)&&<View><Text style={s.label}>TRANCHE D’ÂGE</Text><Text style={s.bodyStrong}>{selected.minAge&&selected.maxAge?`${selected.minAge}-${selected.maxAge} ans`:selected.minAge?`${selected.minAge} ans et plus`:`Jusqu’à ${selected.maxAge} ans`}</Text></View>}</View>
    {selected.organizer?.name&&<View style={s.detailFacts}><View><Text style={s.label}>ORGANISATEUR</Text><Text style={s.bodyStrong}>{selected.organizer.name}</Text></View></View>}
    <Text style={s.sectionTitle}>Une expérience pensée pour de vraies rencontres</Text>
    <Text style={s.paragraph}>Accueil personnalisé, animation légère, temps libres et respect de la confidentialité.</Text>
    {(perkLabels.length>0||selected.perks?.description)&&<View style={s.chips}>{perkLabels.map(l=><Text key={l} style={s.chip}>{l}</Text>)}{selected.perks?.description&&<Text style={s.chip}>{selected.perks.description}</Text>}</View>}
    <Text style={[s.meta,{marginTop:14}]}>{requiresScreening?"Profils sélectionnés":"Inscription directe"} · QR code d’entrée unique · Code de contact privé · Équipe présente sur place</Text>
    <View style={{marginTop:20}}><Text style={s.label}>POLITIQUE D’ANNULATION</Text><Text style={s.paragraph}>Annulation gratuite jusqu’à 24 heures avant l’événement : remboursement intégral automatique. Passé ce délai, aucun remboursement n’est possible de plein droit.</Text></View>
    <GoldButton title="Inviter un ami" secondary onPress={share}/>{message?<Notice text={message} error={!message.includes("envoyée")&&!message.includes("annulée")&&!message.includes("attente")}/>:null}
    {altOffer&&<View style={s.altOffer}><Text style={s.eyebrow}>ÉVÉNEMENT ALTERNATIF PROPOSÉ</Text><Text style={s.sectionTitle}>{altOffer.alternativeEvent.title}</Text><Text style={s.meta}>{when(altOffer.alternativeEvent.startsAt)} · {altOffer.alternativeEvent.district}</Text><Text style={s.bodyStrong}>{money(altOffer.alternativeEvent.priceCents)}</Text><View style={{flexDirection:"row",gap:10,marginTop:10}}><View style={{flex:1}}><GoldButton title={submitting?"…":"Accepter"} onPress={()=>respondAltOffer(true)} disabled={submitting}/></View><View style={{flex:1}}><GoldButton title={submitting?"…":"Refuser"} secondary onPress={()=>respondAltOffer(false)} disabled={submitting}/></View></View></View>}
    {application?<View>
      {application.status==="PAYMENT_PENDING"&&<View style={s.reservationCard}><Text style={s.meta}>{application.reservation?`Votre place est retenue quelques minutes (jusqu’au ${when(application.reservation.expiresAt)}) : finalisez votre paiement.`:"Vous pouvez régler votre billet dès maintenant."}</Text>{selected.priceCents===0?<><ConsentCheck checked={acceptCgv} onChange={setAcceptCgv}>J’ai lu et j’accepte les {legalLink("conditions générales de vente","cgv")}, notamment la politique d’annulation.</ConsentCheck><GoldButton title={submitting?"…":"Confirmer ma place (gratuit)"} onPress={confirmFree} disabled={submitting||!acceptCgv}/></>:<GoldButton title={`Payer par carte · ${money(selected.priceCents)}`} onPress={async()=>{await payByCard(application.id,selected.id,selected.priceCents);await loadApplication(selected.id)}}/>}</View>}
      {application.status==="CONFIRMED"&&!requiresScreening&&!application.networkingAnswer&&!netDismissed&&!netDone&&<View style={s.reservationCard}>
        <Text style={s.meta}>Facultatif : quelques informations professionnelles pour mieux organiser la soirée.</Text>
        {NETWORKING_QUESTIONS.map(q=><View key={q.key}><Text style={s.label}>{q.label.toUpperCase()}</Text><TextInput style={[s.input,{height:60}]} multiline value={netAnswers[q.key]??""} onChangeText={v=>setNetAnswers({...netAnswers,[q.key]:v})}/></View>)}
        <View style={{flexDirection:"row",gap:10,marginTop:10}}><View style={{flex:1}}><GoldButton title={submitting?"…":"Envoyer"} onPress={submitNetworkingFollowUp} disabled={submitting}/></View><View style={{flex:1}}><GoldButton title="Plus tard" secondary onPress={()=>setNetDismissed(true)}/></View></View>
      </View>}
      {application.status==="CONFIRMED"&&netDone&&<Notice text="Merci, vos informations professionnelles ont été enregistrées."/>}
      {waitlistEntry?<View style={s.reservationCard}><Text style={s.eyebrow}>LISTE D’ATTENTE</Text><Text style={s.bodyStrong}>Position {waitlistEntry.rank??waitlistEntry.position}</Text><GoldButton title={submitting?"…":"Quitter la liste d’attente"} secondary onPress={leaveWaitlist} disabled={submitting}/></View>
      :categoryUnknown?<Notice text="Complétez votre catégorie (homme/femme) dans votre profil avant de rejoindre la liste d’attente." error/>
      :full&&canCancel?<GoldButton title={submitting?"…":"Rejoindre la liste d’attente"} secondary onPress={joinWaitlist} disabled={submitting}/>
      :null}
      {canCancel?<GoldButton title={submitting?"…":"Annuler mon inscription"} secondary onPress={cancel} disabled={submitting}/>
      :<Text style={s.meta}>Statut : {application.status}</Text>}
    </View>
    :user.hasRestaurant?<Notice text="Votre compte restaurateur vous permet de découvrir les événements proposés, mais ne permet pas d’y participer."/>
    :requiresScreening&&!user.profile?.validatedAt?<Notice text="Votre profil doit d’abord être validé lors d’un entretien avec Nour Meet avant de vous inscrire à un speed dating. Rendez-vous dans « Mon espace » → « Entretien »." error/>
    :categoryUnknown?<Notice text="Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement." error/>
    :requiresScreening&&showForm?<View>{questions.map(q=><View key={q.key}><Text style={s.label}>{q.label.toUpperCase()}</Text><TextInput style={[s.input,{height:60}]} multiline value={answers[q.key]??""} onChangeText={v=>setAnswers({...answers,[q.key]:v})}/></View>)}<GoldButton title={submitting?"Envoi…":"Envoyer ma candidature"} onPress={apply} disabled={submitting}/></View>
    :full?<View style={s.bookingBar}><Text style={s.meta}>Cet événement est complet</Text><GoldButton title={submitting?"…":"Rejoindre la liste d’attente"} onPress={joinWaitlist} disabled={submitting}/></View>
    :<View style={s.bookingBar}><View>{selected.priceTiers?.length>0?selected.priceTiers.map((t:any)=><Text key={t.category} style={s.meta}>{t.category==="HOMME"?"Hommes":"Femmes"} · <Text style={s.bodyStrong}>{money(t.amountCents)}</Text></Text>):<><Text style={s.meta}>À partir de</Text><Text style={s.bookingPrice}>{money(selected.priceCents)}</Text></>}</View><GoldButton title={requiresScreening?"Candidater":submitting?"…":"S’inscrire"} onPress={()=>requiresScreening?setShowForm(true):apply()} disabled={submitting}/></View>}
  </ScrollView>;
  }
  return <ScrollView contentContainerStyle={s.content}><ScreenTitle eyebrow="CALENDRIER" title="Événements"/><TextInput style={s.search} value={q} onChangeText={setQ} placeholder="Rechercher un événement" placeholderTextColor="#777"/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:16}} contentContainerStyle={{gap:8}}>
      <Pressable onPress={()=>setCategory("")} style={[s.choiceChip,!category&&s.choiceChipActive]}><Text style={[s.choiceChipText,!category&&{color:"#111"}]}>Toutes les catégories</Text></Pressable>
      {EVENT_CATEGORIES.map(c=><Pressable key={c.name} onPress={()=>setCategory(c.name)} style={[s.choiceChip,category===c.name&&s.choiceChipActive]}><Text style={[s.choiceChipText,category===c.name&&{color:"#111"}]}>{c.name}</Text></Pressable>)}
    </ScrollView>
    {events.length===0?<Text style={s.meta}>Aucun événement disponible. Modifiez vos filtres ou revenez prochainement.</Text>:events.map(e=><EventCard key={e.id} event={e} onPress={()=>openEvent(e)}/>)}
  </ScrollView>
}
