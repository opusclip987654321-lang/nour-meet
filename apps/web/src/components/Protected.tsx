import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { homeFor, restaurantEquivalent } from "../lib/spaces";
import { useSeo } from "../lib/seo";
import { Loading } from "./ui";

export function Protected({ children, roles }: {children: ReactNode; roles?: string[]}) {
  const {user,loading}=useAuth();
  const location=useLocation();
  // Espaces personnels et administration : jamais indexés (voir aussi robots.txt).
  useSeo({title:"Mon espace",noindex:true});
  if(loading)return <Loading/>;
  if(!user)return <Navigate to="/login" replace/>;
  // Type de compte pas encore définitif (v3 §5.1) : retour à l'écran de choix, sauf pendant le parcours
  // restaurateur lui-même (formulaire en cours de saisie).
  if(user.needsAccountType&&!["/bienvenue","/restaurant","/restaurant/premier-evenement"].includes(location.pathname))return <Navigate to="/bienvenue" replace/>;
  // Hors de son espace : retour à l'accueil de son rôle ; un restaurateur qui suit un ancien lien
  // /admin retrouve la même section dans /restaurant.
  if(roles&&!roles.includes(user.role))return <Navigate to={user.role==="ORGANIZER"&&location.pathname.startsWith("/admin")?restaurantEquivalent(location.pathname+location.search):homeFor(user)} replace/>;
  return <>{children}</>;
}
