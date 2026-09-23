import { MINIMUM_AGE, isAdult } from "@nour/shared";
import DateTimePicker from "@react-native-community/datetimepicker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { Alert, Image, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { Avatar, ConsentCheck, GoldButton, Notice, ScreenTitle, legalLink } from "../components/ui";
import { C, s } from "../theme";

export function EspaceProfile({user,onSaved,onLogout}:{user:any,onSaved:()=>void,onLogout:()=>void}){
  const [form,setForm]=useState({displayName:user.displayName??"",email:user.email??"",birthDate:user.profile?.birthDate?String(user.profile.birthDate).slice(0,10):"",city:user.profile?.city??"",profession:user.profile?.profession??"",interests:(user.profile?.interests??[]).join(", "),bio:user.profile?.bio??"",quotaCategory:user.profile?.quotaCategory??""});
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[photoBusy,setPhotoBusy]=useState(false);
  const [confirmingDeletion,setConfirmingDeletion]=useState(false);
  const [showDatePicker,setShowDatePicker]=useState(false);
  const [qr,setQr]=useState<any>(null),[loyalty,setLoyalty]=useState<any>(null);
  useEffect(()=>{api("/me/share-qr").then(setQr);api("/loyalty").then(setLoyalty)},[]);
  // CGU §2 : date de naissance obligatoire (majeur) et CGU en vigueur acceptées une fois par version.
  const [acceptCgu,setAcceptCgu]=useState(false);
  const save=async()=>{
    setMessage("");
    if(!isAdult(form.birthDate)){setMessage(`Nūr Meet est réservé aux personnes de ${MINIMUM_AGE} ans et plus : renseignez votre date de naissance.`);return}
    if(!user.cguAccepted&&!acceptCgu){setMessage("Vous devez accepter les conditions générales d’utilisation pour continuer.");return}
    setBusy(true);
    try{await api("/me/profile",{method:"PATCH",body:JSON.stringify({...form,email:form.email||null,quotaCategory:form.quotaCategory||null,interests:form.interests.split(",").map((x:string)=>x.trim()).filter(Boolean),...(acceptCgu?{acceptCgu:true}:{})})});setMessage("Profil enregistré.");onSaved()}
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
  // RGPD (§20) : même contrat que PrivacyPanel côté web (/me/export, /me/request-deletion), juste
  // servi via la feuille de partage native plutôt qu'un téléchargement de navigateur.
  const downloadData=async()=>{
    setBusy(true);setMessage("");
    try{
      const data=await api<object>("/me/export");
      const file=new File(Paths.cache,`nour-meet-mes-donnees-${new Date().toISOString().slice(0,10)}.json`);
      file.write(JSON.stringify(data,null,2));
      await Sharing.shareAsync(file.uri);
    }catch(e){setMessage((e as Error).message)}
    finally{setBusy(false)}
  };
  const confirmDeletion=async()=>{
    setBusy(true);setMessage("");
    try{await api("/me/request-deletion",{method:"POST"});onLogout()}
    catch(e){setMessage((e as Error).message);setBusy(false)}
  };
  return <ScrollView contentContainerStyle={s.content}>
    <ScreenTitle title="Mon profil"/>
    {message?<Notice text={message} error={!message.includes("enregistré")}/>:null}
    <View style={{alignItems:"center",marginVertical:14}}>
      <Avatar name={user.displayName} size={100} photoUrl={user.profile?.photoUrl} verified={!!user.profile?.validatedAt}/>
      <View style={{flexDirection:"row",gap:16,marginTop:12}}>
        <Pressable onPress={pickPhoto} disabled={photoBusy}><Text style={s.link}>{photoBusy?"…":user.profile?.photoUrl?"Changer la photo":"Ajouter une photo"}</Text></Pressable>
        {user.profile?.photoUrl&&<Pressable onPress={removePhoto} disabled={photoBusy}><Text style={[s.link,{color:C.red}]}>Retirer</Text></Pressable>}
      </View>
    </View>
    <Text style={s.label}>PRÉNOM OU PSEUDONYME</Text><TextInput style={s.input} value={form.displayName} onChangeText={v=>setForm({...form,displayName:v})}/>
    <Text style={s.label}>E-MAIL</Text><TextInput style={s.input} value={form.email} onChangeText={v=>setForm({...form,email:v})} keyboardType="email-address" autoCapitalize="none"/>
    <Text style={s.label}>DATE DE NAISSANCE</Text>
    <Pressable onPress={()=>setShowDatePicker(true)} style={[s.input,{justifyContent:"center"}]}><Text style={{color:form.birthDate?C.cream:"#666"}}>{form.birthDate?new Date(form.birthDate).toLocaleDateString("fr-FR"):"Obligatoire"}</Text></Pressable>
    {showDatePicker&&<View>
      <DateTimePicker value={form.birthDate?new Date(form.birthDate):new Date(2000,0,1)} mode="date" display={Platform.OS==="ios"?"spinner":"default"} maximumDate={new Date()} onChange={(_,date)=>{if(Platform.OS==="android")setShowDatePicker(false);if(date)setForm({...form,birthDate:date.toISOString().slice(0,10)})}}/>
      {Platform.OS==="ios"&&<GoldButton title="Terminé" secondary onPress={()=>setShowDatePicker(false)}/>}
    </View>}
    <Text style={s.label}>VILLE</Text><TextInput style={s.input} value={form.city} onChangeText={v=>setForm({...form,city:v})}/>
    <Text style={s.label}>PROFESSION</Text><TextInput style={s.input} value={form.profession} onChangeText={v=>setForm({...form,profession:v})}/>
    <Text style={s.label}>CENTRES D’INTÉRÊT</Text><TextInput style={s.input} value={form.interests} onChangeText={v=>setForm({...form,interests:v})} placeholder="Voyages, Art, Lecture" placeholderTextColor="#666"/>
    <Text style={s.label}>CATÉGORIE (ÉVÉNEMENTS AVEC QUOTAS)</Text>
    <View style={{flexDirection:"row",gap:10,marginBottom:8}}>{[["","Non renseignée"],["HOMME","Homme"],["FEMME","Femme"]].map(([value,label])=><Pressable key={value} onPress={()=>setForm({...form,quotaCategory:value})} style={[s.choiceChip,form.quotaCategory===value&&s.choiceChipActive]}><Text style={[s.choiceChipText,form.quotaCategory===value&&{color:"#111"}]}>{label}</Text></Pressable>)}</View>
    <Text style={s.label}>BIOGRAPHIE</Text><TextInput style={[s.input,{height:90}]} multiline value={form.bio} onChangeText={v=>setForm({...form,bio:v})}/>
    {!user.cguAccepted&&<ConsentCheck checked={acceptCgu} onChange={setAcceptCgu}>Je certifie avoir {MINIMUM_AGE} ans ou plus et j’accepte les {legalLink("conditions générales d’utilisation","cgu")}. Mes données sont traitées conformément à la {legalLink("politique de confidentialité","confidentialite")}.</ConsentCheck>}
    <GoldButton title={busy?"Enregistrement…":"Enregistrer"} onPress={save} disabled={busy}/>
    {qr&&<View style={s.personalQr}><Text style={s.eyebrow}>MON CODE PERSONNEL</Text><Image source={{uri:qr.qrDataUrl}} style={s.qr}/><Text style={s.qrCode}>{qr.code}</Text><Text style={[s.meta,{textAlign:"center"}]}>Le chat s’ouvre uniquement après votre acceptation.</Text></View>}
    {loyalty&&<Text style={[s.meta,{textAlign:"center",marginTop:10}]}>{loyalty.balance} points de fidélité</Text>}
    <Text style={[s.sectionTitle,{marginTop:30}]}>Mes données</Text>
    <Text style={s.paragraph}>Téléchargez une copie de tout ce que nous détenons sur votre compte, ou demandez la suppression de votre compte.</Text>
    <GoldButton title={busy?"…":"Télécharger mes données"} secondary onPress={downloadData} disabled={busy}/>
    {!confirmingDeletion
      ?<GoldButton title="Supprimer mon compte" secondary onPress={()=>setConfirmingDeletion(true)} disabled={busy}/>
      :<><Text style={[s.meta,{marginVertical:8}]}>Vos coordonnées et informations personnelles seront anonymisées ; les paiements déjà effectués restent conservés à des fins comptables et légales. Cette action est irréversible. Annulez d’abord toute réservation active pour un événement à venir.</Text><GoldButton title={busy?"…":"Confirmer la suppression définitive"} onPress={confirmDeletion} disabled={busy}/></>}
    <GoldButton title="Se déconnecter" secondary onPress={onLogout}/>
  </ScrollView>;
}
