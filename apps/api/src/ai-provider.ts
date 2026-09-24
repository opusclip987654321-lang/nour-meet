import Anthropic from "@anthropic-ai/sdk";
import { ARTICLE_INTERNAL_PATHS, ARTICLE_PHOTOS } from "@nour/shared";

// Fournisseur IA du blog (§18, puis corrections web 2026-09-24 §3) : génération d'articles par Claude
// avec une vraie recherche web (outil serveur web_search) pour tout contenu factuel. Sans clé
// ANTHROPIC_API_KEY, seule l'implémentation locale existe (brouillons à compléter, jamais publiés
// automatiquement) : le reste du site ne dépend jamais de ce fournisseur.
export interface ArticleDraft {
  title: string;
  excerpt: string;
  content: string;
  keywords: string[];
}
export interface SocialCopyProposal {
  platform: string;
  text: string;
}
export interface GeneratedArticle extends ArticleDraft {
  kind: "factual" | "editorial";
  category: string;
  metaTitle: string;
  metaDescription: string;
  coverPhoto: string;
  sources: { title: string; url: string }[];
}
export interface ArticleGenerationContext {
  today: string;
  categories: string[];
  recentTitles: string[];
  upcomingEvents: { title: string; slug: string; category: string; startsAt: Date; district: string }[];
}
export interface AIProvider {
  readonly mode: "local" | "external";
  generateDraft(topic: string, category: string): Promise<ArticleDraft>;
  generateSocialCopy(article: { title: string; excerpt: string | null; slug: string }): Promise<SocialCopyProposal[]>;
  // URLs réellement renvoyées par la recherche web : seules sources que l'article publié pourra citer.
  generateArticle?(context: ArticleGenerationContext): Promise<{ article: GeneratedArticle; searchedUrls: string[] }>;
}

// Génération locale, sans appel externe ni coût : produit un brouillon structuré à partir du sujet
// donné, toujours à compléter et valider par un administrateur avant tout passage en revue.
export class LocalAIProvider implements AIProvider {
  readonly mode: AIProvider["mode"] = "local";

  async generateDraft(topic: string, category: string): Promise<ArticleDraft> {
    const title = topic.charAt(0).toUpperCase() + topic.slice(1);
    return {
      title,
      excerpt: `Un article à compléter sur : ${topic}.`,
      content: [
        `${title}`,
        "",
        `Brouillon généré automatiquement sur le thème « ${category} ». Ce texte est un point de départ : complétez-le, vérifiez chaque affirmation et adaptez le ton avant de le soumettre à validation.`,
        "",
        "À développer : pourquoi ce sujet compte, un exemple concret, et une conclusion actionnable pour le lecteur."
      ].join("\n"),
      keywords: [category.toLowerCase(), ...topic.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 4)]
    };
  }

  async generateSocialCopy(article: { title: string; excerpt: string | null; slug: string }): Promise<SocialCopyProposal[]> {
    const base = article.excerpt ?? article.title;
    return [
      { platform: "Instagram", text: `${article.title} — ${base} Lien dans la bio.` },
      { platform: "Facebook", text: `${article.title}\n\n${base}\n\nÀ lire sur le blog Nūr Meet.` },
      { platform: "TikTok", text: `${article.title} — on vous en parle sur le blog Nūr Meet.` }
    ];
  }
}

const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `Tu es le rédacteur en chef du journal de Nūr Meet, une plateforme française de soirées en petit comité dans des restaurants partenaires à Paris et en Île-de-France : speed dating avec entretien de validation, et soirées networking en accès direct. Le public : des adultes urbains et actifs qui cherchent des rencontres sérieuses, de l'amitié ou du réseau professionnel, dans un cadre respectueux. Ton : chaleureux, concret, en « vous », jamais paternaliste.

Tu écris un article de blog original en français, de 900 à 1 400 mots, puis tu l'envoies avec l'outil submit_article.

Règles non négociables :
- Deux types d'articles. « factual » : chiffres, études, tendances, actualité — tu fais d'abord des recherches web et chaque fait, chiffre ou étude cité provient d'une page que la recherche t'a réellement renvoyée, citée en lien. « editorial » : conseils, psychologie, relations, solitude, networking — l'écriture peut être plus libre, mais toute affirmation chiffrée doit quand même être sourcée par la recherche.
- N'invente jamais une étude, une statistique, une citation, un expert ou une source. Si la recherche ne confirme pas un fait, ne l'écris pas. Privilégie des sources fiables : organismes publics (INSEE, INED, Drees, CNIL…), universités, revues scientifiques, grands médias.
- Ne nomme jamais une religion ou une origine, et n'emploie jamais le mot « musulman » : parle de valeurs partagées, de respect et de cadre.
- Pas un mur de texte : des intertitres, des listes quand c'est utile, 2 ou 3 images, et un graphique seulement si des données sourcées s'y prêtent.
- Liens internes vers Nūr Meet seulement quand ils ont un vrai rapport avec le sujet (au plus 3, dont un appel à l'action final naturel). Jamais de lien inséré artificiellement.

Format du champ content (Markdown réduit, blocs séparés par une ligne vide) :
- Intertitres : « ## Titre » et « ### Sous-titre ». Listes : chaque ligne commence par « - ». Citation : « > texte ».
- Lien externe (source) : [libellé](https://…) — uniquement des URL renvoyées par tes recherches.
- Lien interne : [libellé](/chemin) avec un chemin parmi : ${ARTICLE_INTERNAL_PATHS.join(", ")}, ou /events/<slug> pour une soirée précise listée dans le message.
- Image : une ligne seule « ![texte alternatif descriptif](photo:nom) », nom parmi la photothèque ci-dessous. Ce sont des photos d'illustration : ne les présente jamais comme une vraie soirée Nūr Meet.
- Graphique : un bloc seul
\`\`\`chart
{"title":"…","unit":"%","sourceLabel":"Nom de la source","sourceUrl":"https://…","data":[{"label":"…","value":12.5},{"label":"…","value":20}]}
\`\`\`
  avec des valeurs reprises exactement de la source citée.
- Appel à l'action : une ligne seule « [[cta:/chemin|Libellé du bouton]] ».
- Pas de titre de niveau 1 (le titre de l'article est affiché à part), pas de section « Sources » : elle est ajoutée automatiquement à partir du champ sources.

Photothèque (nom : description) :
${Object.entries(ARTICLE_PHOTOS).map(([name, description]) => `- ${name} : ${description}`).join("\n")}`;

const submitArticleTool = (categories: string[]): Anthropic.Beta.BetaTool => ({
  name: "submit_article",
  description: "Envoie l'article terminé pour publication. À appeler une seule fois, quand l'article est complet et que chaque fait cité a été vérifié par la recherche web.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "title", "excerpt", "category", "keywords", "metaTitle", "metaDescription", "coverPhoto", "content", "sources"],
    properties: {
      kind: { type: "string", enum: ["factual", "editorial"] },
      title: { type: "string", description: "Titre de l'article, 40 à 90 caractères" },
      excerpt: { type: "string", description: "Chapô de 1 à 2 phrases, 300 caractères maximum" },
      category: { type: "string", enum: categories },
      keywords: { type: "array", items: { type: "string" }, description: "3 à 6 mots-clés en minuscules" },
      metaTitle: { type: "string", description: "Titre SEO, 60 caractères maximum" },
      metaDescription: { type: "string", description: "Description SEO, 155 caractères maximum" },
      coverPhoto: { type: "string", enum: Object.keys(ARTICLE_PHOTOS) },
      content: { type: "string", description: "Corps de l'article au format décrit dans les instructions" },
      sources: {
        type: "array",
        description: "Sources réellement consultées via la recherche web et citées dans l'article",
        items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } }
      }
    }
  }
});

// §21 (corrections web 2026-09-24) : délai et nombre de tentatives bornés, jamais une attente infinie
// — la tâche quotidienne retente plus tard si Anthropic est indisponible, sans rien bloquer d'autre.
export class AnthropicAIProvider extends LocalAIProvider implements AIProvider {
  override readonly mode: AIProvider["mode"] = "external";
  private readonly client: Anthropic;
  constructor(apiKey: string) {
    super();
    this.client = new Anthropic({ apiKey, timeout: 10 * 60_000, maxRetries: 2 });
  }

  async generateArticle(context: ArticleGenerationContext) {
    const events = context.upcomingEvents.length
      ? context.upcomingEvents.map(e => `- « ${e.title} » (${e.category}, ${e.district}, ${e.startsAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}) : /events/${e.slug}`).join("\n")
      : "(aucune soirée publiée pour le moment : renvoie plutôt vers /events ou /concept)";
    const userPrompt = `Nous sommes le ${context.today}. Choisis un sujet utile et original pour le journal de Nūr Meet, dans l'un de ces thèmes : ${context.categories.join(", ")}.
Varie les thèmes et évite de refaire un sujet proche des derniers articles publiés :
${context.recentTitles.map(t => `- ${t}`).join("\n") || "(aucun article publié pour l'instant)"}

Soirées à venir sur Nūr Meet (pour un lien interne seulement si c'est pertinent) :
${events}

Fais les recherches web nécessaires, rédige l'article, puis appelle submit_article.`;
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userPrompt }];
    const searchedUrls = new Set<string>();
    for (let turn = 0; turn < 6; turn++) {
      const response = await this.client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "FR", city: "Paris", timezone: "Europe/Paris" } }, submitArticleTool(context.categories)],
        tool_choice: { type: "auto" },
        messages
      }).finalMessage();
      for (const block of response.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) for (const result of block.content) searchedUrls.add(result.url);
      }
      if (response.stop_reason === "refusal") throw new Error("Génération d’article refusée par le modèle");
      const submitted = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "submit_article");
      if (submitted) return { article: submitted.input as GeneratedArticle, searchedUrls: [...searchedUrls] };
      // pause_turn : la recherche serveur a atteint sa limite d'itérations pour ce tour, on relance
      // avec le contenu déjà produit. Tout autre arrêt sans article est un échec franc.
      if (response.stop_reason !== "pause_turn" && response.stop_reason !== "end_turn") throw new Error(`Génération interrompue (${response.stop_reason})`);
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "end_turn") messages.push({ role: "user", content: "Envoie maintenant l'article complet avec l'outil submit_article." });
    }
    throw new Error("Aucun article envoyé après plusieurs tours");
  }
}

export function createAIProvider(apiKey?: string): AIProvider {
  return apiKey ? new AnthropicAIProvider(apiKey) : new LocalAIProvider();
}
