import * as WebBrowser from "expo-web-browser";
import { WEB_URL, api } from "./api";

// Stripe n'a pas de module natif installable dans Expo Go (seuls les modules Expo officiels le
// sont) : plutôt que de dupliquer PaymentModal en React Native derrière un client de développement
// natif, le paiement carte ouvre la page web déjà testée (voir PayStandalone dans
// apps/web/src/App.tsx) dans un navigateur intégré. Cahier des charges consolidé final (2026-09-20,
// section 9.2) : on ne met plus jamais le jeton de session (30 jours) dans l'URL — on échange
// d'abord un jeton de paiement opaque, à usage unique et valable 10 minutes, contre lequel la page
// web obtiendra elle-même un vrai jeton de session éphémère (voir /auth/payment-session-exchange).
export const payByCard=async(applicationId:string,eventId:string,amountCents:number)=>{
  const { token }=await api<{token:string}>("/me/payment-sessions",{method:"POST",body:JSON.stringify({applicationId})});
  await WebBrowser.openBrowserAsync(`${WEB_URL}/pay/${applicationId}?session=${encodeURIComponent(token)}&eventId=${eventId}&amount=${amountCents}`);
};
