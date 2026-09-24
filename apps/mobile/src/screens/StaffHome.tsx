import { StatusBar } from "expo-status-bar";
import { ExternalLink, LogOut } from "lucide-react-native";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
import { Button, Logo, Notice, openWeb } from "../components/ui";
import { ROLE_LABEL } from "../labels";
import { T, s } from "../theme";
import { TicketScanner } from "./Scanner";

// Comptes du personnel : l'application ne sert qu'au contrôle des billets à l'entrée ; modération,
// statistiques et gestion des événements restent sur le site d'administration.
export function StaffHome({ user, onLogout }: { user: any; onLogout: () => void }) {
  return <SafeAreaView style={s.safe}><StatusBar style="dark" />
    <View style={s.header}><Logo /></View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.nightPanel}>
        <Text style={[s.meta, { color: T.onNight2 }]}>{ROLE_LABEL[user.role] ?? user.role}</Text>
        <Text style={[s.h1, { color: T.onNight }]}>Bonjour {user.displayName}.</Text>
      </View>
      {user.role === "RECEPTION" || user.role === "ADMIN" ? <TicketScanner /> : <Notice>Le traitement des signalements de modération se fait depuis le site.</Notice>}
      <Text style={s.small}>Le reste de l’administration (statistiques, gestion des événements, entretiens…) se gère depuis le site.</Text>
      <Button variant="secondary" title="Ouvrir l’administration" icon={<ExternalLink size={18} color={T.ink} />} onPress={() => openWeb("/admin")} />
      <Button variant="ghost" title="Se déconnecter" icon={<LogOut size={18} color={T.ink} />} onPress={onLogout} />
    </ScrollView>
  </SafeAreaView>;
}
