// Séparé de api.ts pour que les modules purs (format.ts) puissent lire ces URLs sans importer
// @react-native-async-storage/async-storage au passage — ce module natif ne se charge pas dans un
// environnement Node/Vitest classique, ce qui casserait les tests unitaires de format.ts.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
// Sert à ouvrir la page de paiement web dans un navigateur intégré (voir PayStandalone côté web) :
// Stripe n'a pas de module natif installable dans Expo Go, donc le paiement carte réutilise la
// page web déjà testée plutôt que de dupliquer son intégration Stripe en React Native.
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:5173";
