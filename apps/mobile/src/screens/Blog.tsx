import { ArticleChart, isAllowedInternalPath, parseArticleContent } from "@nour/shared";
import { ArrowLeft, ArrowRight, Inbox } from "lucide-react-native";
import { Fragment, ReactNode, useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { Button, Chip, Empty, Skeleton } from "../components/ui";
import { imgUrl, longDate } from "../format";
import { BLOG_CATEGORIES } from "../labels";
import { Navigate } from "../links";
import { F, R, S, T, s } from "../theme";

// Liens d'un paragraphe, mêmes règles que le site (renderInline, apps/web/src/components/ArticleBody.tsx) :
// un chemin interne autorisé ouvre l'écran correspondant, une URL https la source externe, le reste
// reste du texte brut — jamais un lien vers un écran inexistant.
const renderInline = (text: string, navigate: Navigate): ReactNode[] => text.split(/(\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
  const match = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (!match) return <Fragment key={i}>{part}</Fragment>;
  const [, label, url] = match;
  if (url.startsWith("/") && isAllowedInternalPath(url)) return <Text key={i} style={s.link} onPress={() => navigate(url)}>{label}</Text>;
  if (/^https?:\/\//.test(url)) return <Text key={i} style={s.link} onPress={() => Linking.openURL(url)}>{label}</Text>;
  return <Fragment key={i}>{label}</Fragment>;
});

// Graphique d'article : une série, barres horizontales fines, valeurs en encre de texte, source visible.
function ArticleBarChart({ chart }: { chart: ArticleChart }) {
  const max = Math.max(...chart.data.map(d => d.value), 0) || 1;
  const format = (v: number) => `${v.toLocaleString("fr-FR")}${chart.unit ? ` ${chart.unit}` : ""}`;
  return <View style={[s.panel, { gap: S[2] }]} accessible accessibilityLabel={`${chart.title} : ${chart.data.map(d => `${d.label} ${format(d.value)}`).join(", ")}`}>
    <Text style={s.h3}>{chart.title}</Text>
    {chart.data.map(d => <View key={d.label} style={{ gap: 4 }}>
      <View style={[s.row, { justifyContent: "space-between" }]}><Text style={[s.small, { flex: 1 }]}>{d.label}</Text><Text style={[s.small, { fontFamily: F.textSemi, color: T.ink }]}>{format(d.value)}</Text></View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: T.surface2 }}><View style={{ height: 8, borderRadius: 4, width: `${Math.max(0, (d.value / max) * 100)}%`, backgroundColor: T.chart }} /></View>
    </View>)}
    <Text style={s.meta}>Source : <Text style={s.link} onPress={() => Linking.openURL(chart.sourceUrl)}>{chart.sourceLabel}</Text></Text>
  </View>;
}

function ArticleBody({ content, navigate }: { content: string; navigate: Navigate }) {
  return <View style={{ gap: S[4] }}>{parseArticleContent(content).map((block, i) => {
    switch (block.type) {
      case "heading": return <Text key={i} style={block.level === 2 ? [s.h2, { marginTop: S[2] }] : s.h3} accessibilityRole="header">{block.text}</Text>;
      case "paragraph": return <Text key={i} style={s.body}>{renderInline(block.text, navigate)}</Text>;
      case "list": return <View key={i} style={{ gap: S[2] }}>{block.items.map((item, j) => <View key={j} style={{ flexDirection: "row", gap: S[2] }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.saffron, marginTop: 9 }} /><Text style={[s.body, { flex: 1 }]}>{renderInline(item, navigate)}</Text></View>)}</View>;
      case "quote": return <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: T.saffron, paddingLeft: S[4] }}><Text style={[s.body, { fontFamily: F.textMedium, color: T.ink }]}>{renderInline(block.text, navigate)}</Text></View>;
      case "image": return <View key={i} style={{ gap: S[1] }}><Image source={{ uri: imgUrl(`photo:${block.photo}`) }} accessibilityLabel={block.alt} style={{ width: "100%", aspectRatio: 3 / 2, borderRadius: R.md, backgroundColor: T.surface2 }} /><Text style={s.meta}>Photo d’illustration</Text></View>;
      case "chart": return <ArticleBarChart key={i} chart={block.chart} />;
      case "cta": return isAllowedInternalPath(block.path) ? <Button key={i} title={block.label} icon={<ArrowRight size={18} color={T.onNight} />} onPress={() => navigate(block.path)} /> : null;
    }
  })}</View>;
}

const AiTag = () => <View style={{ position: "absolute", left: S[2], bottom: S[2], paddingHorizontal: S[2], paddingVertical: 3, borderRadius: R.sm, backgroundColor: "rgba(21,23,28,0.72)" }}><Text style={{ fontFamily: F.textSemi, fontSize: 11, color: T.onNight }}>Illustration générée par IA</Text></View>;

export function Blog({ slug, navigate, goBack }: { slug?: string; navigate: Navigate; goBack: () => boolean }) {
  return slug ? <Article slug={slug} navigate={navigate} goBack={goBack} /> : <BlogList navigate={navigate} />;
}

function BlogList({ navigate }: { navigate: Navigate }) {
  const [articles, setArticles] = useState<any[] | null>(null), [category, setCategory] = useState("");
  useEffect(() => {
    let ignore = false;
    setArticles(null);
    api<any[]>(`/articles${category ? `?category=${encodeURIComponent(category)}` : ""}`).then(a => { if (!ignore) setArticles(a); }).catch(() => { if (!ignore) setArticles([]); });
    return () => { ignore = true; };
  }, [category]);
  return <ScrollView contentContainerStyle={s.content}>
    <Text style={s.h1} accessibilityRole="header">Rencontres, amitié et vie sociale</Text>
    <Text style={s.body}>Des repères concrets et des études sourcées pour rencontrer, se faire des amis et développer son réseau.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S[2] }}>
      <Chip label="Tous les thèmes" active={!category} onPress={() => setCategory("")} />
      {BLOG_CATEGORIES.map(c => <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />)}
    </ScrollView>
    {articles === null ? [0, 1, 2].map(i => <Skeleton key={i} height={280} />)
      : articles.length === 0 ? <Empty icon={<Inbox size={24} color={T.ink3} />} title="Aucun article pour le moment" />
        : articles.map(a => <Pressable key={a.id} accessibilityRole="link" onPress={() => navigate({ name: "blog", slug: a.slug })} style={({ pressed }) => [s.card, { padding: 0, overflow: "hidden", opacity: pressed ? 0.9 : 1 }]}>
          {a.imageUrl && <View><Image source={{ uri: imgUrl(a.imageUrl) }} style={{ width: "100%", aspectRatio: 4 / 3, backgroundColor: T.surface2 }} />{a.imageAiGenerated && <AiTag />}</View>}
          <View style={{ padding: S[4], gap: S[1] }}>
            <Text style={s.meta}>{a.category}{a.publishedAt ? ` · ${longDate(a.publishedAt)}` : ""}</Text>
            <Text style={s.h3}>{a.title}</Text>
            {a.excerpt && <Text style={s.small} numberOfLines={3}>{a.excerpt}</Text>}
          </View>
        </Pressable>)}
  </ScrollView>;
}

function Article({ slug, navigate, goBack }: { slug: string; navigate: Navigate; goBack: () => boolean }) {
  const [article, setArticle] = useState<any>(null), [notFound, setNotFound] = useState(false);
  useEffect(() => { api<any>(`/articles/${slug}`).then(setArticle).catch(() => setNotFound(true)); }, [slug]);
  const back = <Pressable accessibilityRole="link" onPress={() => { if (!goBack()) navigate({ name: "blog" }); }} style={[s.row, { minHeight: 44 }]}><ArrowLeft size={18} color={T.saffronInk} /><Text style={s.link}>Le journal</Text></Pressable>;
  if (notFound) return <ScrollView contentContainerStyle={s.content}>{back}<Empty icon={<Inbox size={24} color={T.ink3} />} title="Article introuvable" text="Cet article n’existe pas ou n’est plus en ligne." /></ScrollView>;
  if (!article) return <ScrollView contentContainerStyle={s.content}>{back}<Skeleton height={20} width={140} /><Skeleton height={64} /><Skeleton height={240} /></ScrollView>;
  return <ScrollView contentContainerStyle={s.content}>
    {back}
    <Text style={s.meta}>{article.category}{article.publishedAt ? ` · ${longDate(article.publishedAt)}` : ""}</Text>
    <Text style={s.h1} accessibilityRole="header">{article.title}</Text>
    {article.excerpt && <Text style={[s.body, { fontSize: 18, lineHeight: 27 }]}>{article.excerpt}</Text>}
    {article.imageUrl && <View style={{ gap: S[1] }}><Image source={{ uri: imgUrl(article.imageUrl) }} style={{ width: "100%", aspectRatio: 3 / 2, borderRadius: R.md, backgroundColor: T.surface2 }} />{article.imageAiGenerated && <Text style={s.meta}>Illustration générée par IA</Text>}</View>}
    <ArticleBody content={article.content} navigate={navigate} />
    <View style={s.nightPanel}>
      <Text style={[s.h3, { color: T.onNight }]}>Envie de passer de la lecture à la rencontre ?</Text>
      <Button variant="accent" title="Voir les prochaines soirées" onPress={() => navigate({ name: "events" })} />
    </View>
  </ScrollView>;
}
