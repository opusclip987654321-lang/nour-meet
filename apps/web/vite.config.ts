import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Adresse publique du site (liens canoniques, Open Graph) : vide en local, où les chemins relatifs suffisent.
process.env.VITE_SITE_URL ??= "";

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  // En local, robots.txt, sitemap.xml et llms.txt viennent de l'API comme en production (Caddy).
  server: { port: 5173, proxy: Object.fromEntries(["/sitemap.xml", "/robots.txt", "/llms.txt"].map(p => [p, process.env.VITE_API_URL ?? "http://localhost:4000"])) }
});
