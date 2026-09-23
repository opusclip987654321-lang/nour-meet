import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { Avatar, GoldButton, Notice, ScreenTitle } from "../components/ui";
import { C, s } from "../theme";

export function Scanner(){
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
export function TicketScanner(){
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
