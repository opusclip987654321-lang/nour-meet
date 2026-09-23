import { StatusBar } from "expo-status-bar";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
import { GoldButton, Logo, Notice } from "../components/ui";
import { ROLE_LABEL } from "../labels";
import { s } from "../theme";
import { TicketScanner } from "./Scanner";

export function StaffHome({user,onLogout}:{user:any,onLogout:()=>void}){
  return <SafeAreaView style={s.safe}><StatusBar style="light"/><ScrollView contentContainerStyle={s.content}>
    <Logo/>
    <View style={s.loginHero}><Text style={s.eyebrow}>{ROLE_LABEL[user.role]??user.role}</Text><Text style={s.homeTitle}>Bonjour {user.displayName}.</Text></View>
    {user.role==="RECEPTION"||user.role==="ADMIN"?<TicketScanner/>:<Notice text="Utilisez le site nour-meet pour traiter les signalements de modération."/>}
    <Text style={[s.meta,{marginTop:24}]}>Le reste de l’administration (statistiques, finance, gestion des événements…) se gère depuis le site nour-meet.</Text>
    <GoldButton title="Se déconnecter" secondary onPress={onLogout}/>
  </ScrollView></SafeAreaView>;
}
