import { INTEREST_GROUPS, MAX_INTERESTS, foldText } from "@nour/shared";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { S, s } from "../theme";
import { Chip, Field } from "./ui";

// Centres d'intérêt (décision v2 §1.3) : même liste fermée que le site (@nour/shared), recherche,
// un centre choisi quitte les propositions et reste affiché, retirable d'un appui.
export function InterestPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [query, setQuery] = useState("");
  const full = value.length >= MAX_INTERESTS;
  const groups = useMemo(() => {
    const q = foldText(query.trim());
    return INTEREST_GROUPS.map(g => ({ theme: g.theme, items: g.items.filter(i => !value.includes(i) && (!q || foldText(i).includes(q))) })).filter(g => g.items.length > 0);
  }, [query, value]);
  return <View style={{ gap: S[2] }}>
    <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.label}>Centres d’intérêt</Text><Text style={s.meta}>{value.length}/{MAX_INTERESTS}</Text></View>
    {value.length > 0 && <View style={[s.row, { flexWrap: "wrap" }]}>{value.map(i => <Chip key={i} label={`${i}  ×`} active onPress={() => onChange(value.filter(v => v !== i))} />)}</View>}
    {full
      ? <Text style={s.meta}>Vous avez choisi {MAX_INTERESTS} centres d’intérêt, le maximum. Retirez-en un pour en ajouter un autre.</Text>
      : <>
        <Field label="Rechercher un centre d’intérêt" value={query} onChangeText={setQuery} placeholder="Cinéma, randonnée, entrepreneuriat…" autoCorrect={false} />
        <View style={{ gap: S[3], maxHeight: 320 }}>
          {groups.length === 0 ? <Text style={s.meta}>Aucun centre d’intérêt ne correspond.</Text>
            : (query ? groups : groups.slice(0, 3)).map(g => <View key={g.theme} style={{ gap: S[1] }}><Text style={s.meta}>{g.theme}</Text><View style={[s.row, { flexWrap: "wrap" }]}>{g.items.map(i => <Chip key={i} label={`+ ${i}`} active={false} onPress={() => { onChange([...value, i]); setQuery(""); }} />)}</View></View>)}
          {!query && groups.length > 3 && <Text style={s.meta}>Tapez un mot pour voir les autres thèmes.</Text>}
        </View>
      </>}
  </View>;
}
