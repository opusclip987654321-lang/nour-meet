import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { CategoryChip, GoldButton, Notice, ScreenTitle } from "../components/ui";
import { dayLabel, money, timeLabel, when } from "../format";
import { APPLICATION_STATUS_LABEL } from "../labels";
import { payByCard } from "../payment";
import { C, s } from "../theme";
import { EspaceTab } from "../types";
import { EspaceProfile } from "./EspaceProfile";

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
    try{await api(`/alternative-offers/${offerId}/respond`,{method:"POST",body:JSON.stringify({accept})});setMessage(accept?"Place réservée : réglez votre billet ci-dessous.":"Proposition refusée.");onChanged()}
    catch(e){setMessage((e as Error).message)}
    finally{setBusyId(null)}
  };
  return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle title="Mes événements"/>
    {message?<Notice text={message}/>:null}
    {eventApps.length===0?<Text style={s.meta}>Aucune inscription pour le moment.</Text>:eventApps.map(a=>{
      const offersForEvent=pendingOffers.filter(o=>o.originalEventId===a.eventId);
      return <View key={a.id} style={s.reservationCard}>
        <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-start"}}><CategoryChip category={a.event.category}/><Text style={s.meta}>{APPLICATION_STATUS_LABEL[a.status]??a.status}</Text></View>
        <Text style={s.sectionTitle}>{a.event.title}</Text>
        <Text style={s.meta}>{when(a.event.startsAt)} · {a.event.district}</Text>
        {a.call&&a.status==="CALL_SCHEDULED"&&<Text style={s.meta}>Entretien : {when(a.call.startsAt)}</Text>}
        {offersForEvent.map(offer=><AltOfferCard key={offer.id} offer={offer} busy={busyId===offer.id} onRespond={accept=>respondOffer(offer.id,accept)}/>)}
        {a.status==="PAYMENT_PENDING"&&<GoldButton title={`Payer par carte · ${money(a.event.priceCents)}`} onPress={async()=>{await payByCard(a.id,a.event.id,a.event.priceCents);onChanged()}}/>}
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

export function Espace({user,onSaved,onLogout}:{user:any,onSaved:()=>void,onLogout:()=>void}){
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
