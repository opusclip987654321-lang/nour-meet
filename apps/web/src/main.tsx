import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { reloadOnceForNewVersion } from "./lib/new-version";
import { initSentry } from "./sentry";
import "./styles.css";

// Vite signale ici l'échec de préchargement d'un fichier d'une version précédente.
window.addEventListener("vite:preloadError", event => { if (reloadOnceForNewVersion()) event.preventDefault(); });

initSentry().catch(() => { /* surveillance indisponible : le site continue */ });

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
