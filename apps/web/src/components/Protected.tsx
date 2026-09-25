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
  // Hors de son espace : retour à l'accueil de son rôle ; un restaurateur qui suit un ancien lien
  // /admin retrouve la même section dans /restaurant.
  if(roles&&!roles.includes(user.role))return <Navigate to={user.role==="ORGANIZER"&&location.pathname.startsWith("/admin")?restaurantEquivalent(location.pathname+location.search):homeFor(user)} replace/>;
  return <>{children}</>;
}
