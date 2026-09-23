import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, SafeAreaView, Text, TextInput, View } from "react-native";
import { api, setToken } from "../api";
import { GoldButton, Logo, Notice } from "../components/ui";
import { s } from "../theme";

export function Login({onLogin}:{onLogin:(opts?:{restaurateur?:boolean})=>void}){
  const [phone,setPhone]=useState(""),[code,setCode]=useState(""),[step,setStep]=useState<1|2|3>(1),[busy,setBusy]=useState(false),[error,setError]=useState(""),[devCode,setDevCode]=useState<string|null>(null);
  // isNewUser (renvoyé une seule fois, à la création du compte) déclenche l'écran de choix
  // participant/restaurateur, jamais revu ensuite — même logique que sur le web (voir Login() dans
  // apps/web/src/App.tsx).
  const submit=async()=>{setBusy(true);setError("");try{if(step===1){const r=await api<{delivery:"mock"|"sms";devCode?:string}>("/auth/request-otp",{method:"POST",body:JSON.stringify({phone})});setDevCode(r.devCode??null);setStep(2)}else{const r=await api<{token:string;isNewUser?:boolean}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone,code})});await setToken(r.token);if(r.isNewUser)setStep(3);else onLogin()}}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  if(step===3)return <SafeAreaView style={s.safe}><StatusBar style="light"/><View style={s.login}><Logo/><View style={s.loginHero}><Text style={s.eyebrow}>BIENVENUE</Text><Text style={s.loginTitle}>Que souhaitez-vous{`\n`}faire sur Nūr Meet ?</Text><Text style={s.paragraph}>Ce choix détermine votre espace ; il ne peut être fait qu’une seule fois, à la création du compte.</Text></View><GoldButton title="Participer aux événements" onPress={()=>onLogin()}/><GoldButton title="Je suis restaurateur" secondary onPress={()=>onLogin({restaurateur:true})}/></View></SafeAreaView>;
  return <SafeAreaView style={s.safe}><StatusBar style="light"/><KeyboardAvoidingView style={s.login} behavior={Platform.OS==="ios"?"padding":undefined}><Logo/><View style={s.loginHero}><Text style={s.eyebrow}>BIENVENUE</Text><Text style={s.loginTitle}>{step===1?"Votre numéro\nouvre la porte.":"Entrez le code\nreçu par SMS."}</Text><Text style={s.paragraph}>{step===1?"Connexion rapide et sécurisée, sans mot de passe.":`Code envoyé au ${phone}`}</Text></View>{error?<Notice text={error} error/>:null}<Text style={s.label}>{step===1?"NUMÉRO DE TÉLÉPHONE":"CODE À SIX CHIFFRES"}</Text><TextInput style={[s.input,step===2&&s.otp]} value={step===1?phone:code} onChangeText={step===1?setPhone:v=>setCode(v.replace(/\D/g,"").slice(0,6))} keyboardType="phone-pad" textContentType={step===2?"oneTimeCode":"telephoneNumber"} placeholderTextColor="#666" placeholder={step===1?"+33612345678":"••••••"}/><GoldButton title={busy?"Patientez…":step===1?"Recevoir mon code":"Vérifier"} onPress={submit} disabled={busy}/>{devCode?<View style={s.demo}><Text style={s.demoTitle}>MODE LOCAL — AUCUN SMS FACTURÉ</Text><Text style={s.meta}>Code de développement : {devCode}</Text></View>:null}</KeyboardAvoidingView></SafeAreaView>
}
