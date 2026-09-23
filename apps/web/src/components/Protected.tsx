import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { STAFF_ROLES, useAuth } from "../auth";
import { Loading } from "./ui";

export function Protected({ children, roles }: {children: ReactNode; roles?: string[]}) {
  const {user,loading}=useAuth();
  if(loading)return <Loading/>;
  if(!user)return <Navigate to="/login" replace/>;
  if(roles&&!roles.includes(user.role))return <Navigate to={STAFF_ROLES.includes(user.role)?"/admin":"/dashboard"} replace/>;
  return <>{children}</>;
}
