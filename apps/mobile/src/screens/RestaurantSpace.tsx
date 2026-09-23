import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { GoldButton, Notice, ScreenTitle, ToggleChip } from "../components/ui";
import { imgUrl } from "../format";
import { C, s } from "../theme";
import { TicketScanner } from "./Scanner";

// Espace dédié aux comptes restaurateurs (candidature en cours ou déjà approuvée), voir
// RestaurantSpace/RestaurantApplication dans apps/web/src/App.tsx pour l'équivalent web : plus un
// onglet du dashboard participant, car un restaurateur n'a plus le droit d'y participer aux
// événements — seulement de les consulter. Remplace l'onglet "Mon espace" par "Mon établissement".
const emptyRestaurantForm={name:"",managerName:"",siret:"",description:"",district:"",address:"",phone:"",desiredCapacity:"",desiredSchedule:"",averagePricePerPersonCents:"",defaultMinParticipants:"",priceIncludesDrink:false,priceIncludesStarter:false,priceIncludesMain:false,priceIncludesDessert:false,priceNotes:"",proposesCategoryPricing:false,allowsPrivatization:false,specialConditions:""};

export function RestaurantSpace({onLogout}:{onLogout:()=>void}){
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
    {restaurant.subscription&&<Text style={[s.meta,{marginTop:8}]}>Abonnement « {restaurant.subscription.plan.name} » — {(restaurant.subscription.plan.monthlyPriceCents/100).toFixed(0)} €/mois — statut : {restaurant.subscription.status} — {restaurant.currentMonthEventsPublished}{restaurant.subscription.plan.monthlyEventQuota==null?" événements publiés ce mois-ci (illimité)":`/${restaurant.subscription.plan.monthlyEventQuota} événements publiés ce mois-ci`}.</Text>}
    {message?<Notice text={message} error={!message.includes("mise à jour")}/>:null}
    <Text style={s.sectionTitle}>Fiche établissement</Text>
    {priceFields}
    <GoldButton title={submitting?"Enregistrement…":"Enregistrer"} onPress={saveProfile} disabled={submitting}/>
    <Text style={[s.sectionTitle,{marginTop:24}]}>Galerie ({(restaurant.photos??[]).length}/8)</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:10,marginBottom:14}}>
      {(restaurant.photos??[]).map((p:any)=><View key={p.id} style={{width:100}}><Image source={{uri:imgUrl(p.url)}} style={{width:100,height:100,borderRadius:8}}/><Pressable onPress={()=>removePhoto(p.id)} disabled={photoBusy}><Text style={[s.link,{marginTop:4,textAlign:"center"}]}>Retirer</Text></Pressable></View>)}
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
