const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

// react-native@0.86.2/0.87.1 bloquent l'import package-relative "react-native/rn-get-polyfills"
// via leur champ "exports" (même quand le fichier existe), alors que le config Metro par défaut
// d'Expo en dépend encore pour construire la liste des polyfills. Le paquet @react-native/js-
// polyfills expose exactement la même fonction que ce fichier enveloppait : on la branche
// directement, sans jamais passer par le chemin bloqué.
const config = getDefaultConfig(__dirname);
config.serializer.getPolyfills = () => require("@react-native/js-polyfills")();

// Monorepo npm workspaces : par défaut, Metro ne remonte pas jusqu'à la racine du monorepo pour
// résoudre les paquets hissés là-bas (ex. "invariant", partagé par plusieurs dépendances sans
// conflit de version) — d'où "invariant could not be found". Seul le résolveur a besoin de
// connaître ce chemin ; l'ajouter aussi à watchFolders ferait crawler tout node_modules racine
// (735+ paquets) et les autres apps du monorepo à chaque démarrage, ce qui a fait dépasser le
// délai de connexion du client. On ne touche donc qu'à nodeModulesPaths.
const workspaceRoot = path.resolve(__dirname, "../..");
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
