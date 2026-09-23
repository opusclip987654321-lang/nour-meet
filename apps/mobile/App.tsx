import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, View } from "react-native";
import { api, getToken, setToken } from "./src/api";
import { TabBar } from "./src/components/ui";
import { Blog } from "./src/screens/Blog";
import { Espace } from "./src/screens/Espace";
import { Events } from "./src/screens/Events";
import { Concept, Home } from "./src/screens/Home";
import { Login } from "./src/screens/Login";
import { Messages } from "./src/screens/Messages";
import { RestaurantSpace } from "./src/screens/RestaurantSpace";
import { Scanner } from "./src/screens/Scanner";
import { StaffHome } from "./src/screens/StaffHome";
import { C, s } from "./src/theme";
import { Tab } from "./src/types";

export default function App(){
  const [loading,setLoading]=useState(true),[user,setUser]=useState<any>(null),[tab,setTab]=useState<Tab>("home");
  // Vrai dès que le choix "restaurateur" a été fait au premier login (voir Login) ET tant que la
  // fiche Restaurant n'existe pas encore côté serveur : sans ça, un tout nouveau candidat n'aurait
  // aucun moyen d'atterrir sur le formulaire, puisque user.hasRestaurant reste faux jusqu'à l'envoi
  // de sa demande (même logique que le navigate("/restaurant") du web, voir Login() sur le web).
  const [forceRestaurantSpace,setForceRestaurantSpace]=useState(false);
  const [eventsCategory,setEventsCategory]=useState("");
  const load=async()=>{setLoading(true);try{if(await getToken())setUser(await api("/me"));else setUser(null)}catch{await setToken(null);setUser(null)}finally{setLoading(false)}};useEffect(()=>{load()},[]);
  const logout=async()=>{await setToken(null);setUser(null);setForceRestaurantSpace(false)};
  if(loading)return <SafeAreaView style={[s.safe,s.center]}><ActivityIndicator color={C.gold}/></SafeAreaView>;
  if(!user)return <Login onLogin={opts=>{if(opts?.restaurateur){setForceRestaurantSpace(true);setTab("profile")}load()}}/>;
  if(["ADMIN","MODERATOR","RECEPTION"].includes(user.role))return <StaffHome user={user} onLogout={logout}/>;
  const showRestaurantSpace=user.hasRestaurant||forceRestaurantSpace;
  return <SafeAreaView style={s.safe}><StatusBar style="light"/><View style={s.app}>{tab==="home"&&<Home user={user} setTab={setTab}/>} {tab==="events"&&<Events user={user} initialCategory={eventsCategory}/>}{tab==="concept"&&<Concept setTab={setTab}/>}{tab==="blog"&&<Blog setTab={setTab} goToEvents={(category:string)=>{setEventsCategory(category);setTab("events")}}/>}{tab==="scan"&&<Scanner/>}{tab==="messages"&&<Messages user={user}/>} {tab==="profile"&&(showRestaurantSpace?<RestaurantSpace onLogout={logout}/>:<Espace user={user} onSaved={load} onLogout={logout}/>)}</View><TabBar tab={tab} setTab={setTab} profileLabel={showRestaurantSpace?"Mon établissement":"Mon espace"}/></SafeAreaView>
}
