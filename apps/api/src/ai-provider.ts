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
  // Description (en anglais) de l'illustration à générer, et légende de la publication Instagram.
  imagePrompt: string;
  instagramCaption: string;
}
// Verdict du contrôle visuel d'une illustration générée, avant toute publication.
export interface ImageReview { approved: boolean; issues: string[]; altText: string }
// Carrousel Instagram réécrit (refonte du 2026-09-26) : texte brut renvoyé par Claude, validé ensuite par
// parseCarouselScript (instagram-carousel.ts) avant tout usage. Champs sans objet pour un format : "".
export interface CarouselDraftSlide {
  kind: "contrast" | "statement" | "list" | "quote" | "scene" | "stat";
  title: string;
  text: string;
  items: string[];
  myth: string;
  reality: string;
  highlight: string;
  value: string;
  source: string;
  imagePrompt: string;
}
export interface CarouselDraft { hook: string; subtitle: string; slides: CarouselDraftSlide[]; ctaHeadline: string; ctaDetail: string; ctaImagePrompt: string; caption: string }
export interface ArticleGenerationContext {
  today: string;
  // Consigne visuelle imposée pour l'illustration de couverture (image-variety.ts).
  coverBrief?: string;
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
  reviewCoverImage?(image: Buffer, context: { title: string; imagePrompt: string }): Promise<ImageReview>;
  // briefs : consignes visuelles imposées, une par slide dans l'ordre, la dernière pour l'appel à l'action.
  writeCarousel?(article: { title: string; excerpt: string | null; content: string; category: string }, briefs: string[]): Promise<CarouselDraft>;
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

// Charte des illustrations générées, commune à la couverture et aux slides du carrousel.
// Le décor n'est plus limité aux cafés et terrasses : chaque image reçoit une consigne visuelle imposée
// (image-variety.ts), pour ne pas publier toujours la même scène.
const ILLUSTRATION_CHARTER = "une scène photographique réaliste, naturelle et chaleureuse qui illustre le sujet. Personnes : adultes français d'origine majoritairement maghrébine et subsaharienne, hommes et femmes (avec ou sans foulard), d'âges et de styles variés, dans un décor urbain français reconnaissable. Respecte exactement la consigne visuelle imposée (décor, cadrage, lumière, personnes) quand elle est donnée. Privilégie les scènes, les mains, les silhouettes et les personnes de trois quarts ou de dos plutôt que les gros plans de visages. Les boissons ne sont pas nécessaires : n'en montre que si la scène l'exige. Interdits : alcool et toute boisson qui pourrait y ressembler (cocktail, grand verre avec glaçons et paille, verre à pied, bouteille) — si des boissons apparaissent, uniquement du thé chaud dans de petits verres ou du café ; symboles ou lieux religieux, calligraphie, texte, logos, filigranes. Composition centrée (l'image sera recadrée en carré pour Instagram).";
// Légende courte et accrocheuse (refonte du 2026-09-26), à la place de « titre + chapô + hashtags génériques ».
const CAPTION_RULES = "400 caractères au plus hors hashtags. Une première ligne qui accroche (une phrase courte, pas le titre recopié), une ou deux phrases au plus qui donnent envie de lire, « Article complet : lien en bio », puis 3 à 5 hashtags précis liés au sujet, en minuscules. Pas d'URL, un emoji au plus, jamais le mot « musulman ».";

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

Illustration de couverture (champ imagePrompt, en anglais) : ${ILLUSTRATION_CHARTER}

Légende Instagram (champ instagramCaption, en français) : ${CAPTION_RULES}

Photothèque (nom : description) :
${Object.entries(ARTICLE_PHOTOS).map(([name, description]) => `- ${name} : ${description}`).join("\n")}`;

const submitArticleTool = (categories: string[]): Anthropic.Beta.BetaTool => ({
  name: "submit_article",
  description: "Envoie l'article terminé pour publication. À appeler une seule fois, quand l'article est complet et que chaque fait cité a été vérifié par la recherche web.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "title", "excerpt", "category", "keywords", "metaTitle", "metaDescription", "coverPhoto", "content", "sources", "imagePrompt", "instagramCaption"],
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
      imagePrompt: { type: "string", description: "Description en anglais de l'illustration de couverture à générer" },
      instagramCaption: { type: "string", description: "Légende de la publication Instagram, en français" },
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

${context.coverBrief ? `Consigne visuelle imposée pour l'illustration de couverture (imagePrompt), à reprendre telle quelle : ${context.coverBrief}\n\n` : ""}Fais les recherches web nécessaires, rédige l'article, puis appelle submit_article.`;
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

  // Contrôle visuel automatique d'une illustration générée (corrections du 2026-09-24) : aucune image
  // n'est publiée sans être passée par ce contrôle, qui applique la charte visuelle de Nūr Meet.
  async reviewCoverImage(image: Buffer, context: { title: string; imagePrompt: string }): Promise<ImageReview> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: "Tu contrôles les illustrations publiées par Nūr Meet (soirées de rencontre et de networking à Paris, public : adultes musulmans français, majoritairement d'origine maghrébine et subsaharienne). Tu refuses une image au moindre doute sérieux.",
      tools: [{
        name: "report_review", strict: true,
        description: "Rend le verdict sur l'illustration.",
        input_schema: { type: "object", additionalProperties: false, required: ["approved", "issues", "altText"], properties: {
          approved: { type: "boolean" },
          issues: { type: "array", items: { type: "string" }, description: "Problèmes constatés, en français (vide si approuvée)" },
          altText: { type: "string", description: "Texte alternatif en français, une phrase descriptive, sans « image de »" }
        } }
      }],
      tool_choice: { type: "tool", name: "report_review" },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
        { type: "text", text: `Illustration de couverture pour l'article « ${context.title} ». Description demandée : ${context.imagePrompt}\n\nRefuse l'image si : défaut visible (mains, doigts, visages déformés, corps incohérents), texte, lettres, logo ou filigrane, alcool ou toute boisson qui pourrait passer pour de l'alcool (cocktail, mojito, grand verre avec glaçons ou paille, verre à pied, bouteille — dans le doute, refuse), symbole ou lieu religieux, calligraphie, décor qui ne ressemble pas à la France, personnes qui ne correspondent pas au public décrit (par exemple typées d'Asie du Sud ou du Sud-Est), contenu suggestif ou inapproprié, ou image sans rapport avec le sujet. Sinon approuve-la. Appelle report_review.` }
      ] }]
    });
    const verdict = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!verdict) throw new Error("Contrôle d'image sans verdict");
    return verdict.input as ImageReview;
  }

  // Carrousel Instagram réécrit (refonte du 2026-09-26) : une version courte et percutante de l'article,
  // sans aucun fait ni chiffre ajouté. Pas de recherche web : l'article publié est la seule source.
  async writeCarousel(article: { title: string; excerpt: string | null; content: string; category: string }, briefs: string[]): Promise<CarouselDraft> {
    const slideBriefs = briefs.slice(0, -1).map((b, i) => `- slide ${i + 1} : ${b}`).join("\n");
    const visual = briefs.length ? `\n\nConsignes visuelles imposées, une par image, pour que chaque photo soit différente des autres (décor, cadrage, lumière, personnes) — reprends-les dans chaque imagePrompt en les adaptant au sujet de la slide :\n${slideBriefs}\n- ctaImagePrompt : ${briefs[briefs.length - 1]}` : "";
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: CAROUSEL_PROMPT,
      tools: [carouselTool],
      tool_choice: { type: "tool", name: "submit_carousel" },
      messages: [{ role: "user", content: `Article du journal Nūr Meet (${article.category}).\n\nTitre : ${article.title}\n\nChapô : ${article.excerpt ?? "(aucun)"}\n\n${article.content}${visual}` }]
    });
    if (response.stop_reason === "refusal") throw new Error("Carrousel refusé par le modèle");
    const submitted = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!submitted) throw new Error("Carrousel non renvoyé par le modèle");
    return submitted.input as CarouselDraft;
  }
}

const CAROUSEL_PROMPT = `Tu adaptes un article du journal de Nūr Meet (soirées de rencontre et de networking en petit comité à Paris) en carrousel Instagram, puis tu l'envoies avec l'outil submit_carousel.

Ton : réseaux sociaux, en « tu », court et percutant, chaleureux. Joue sur l'émotion : parle de ce que le lecteur ressent et vit (l'appréhension avant d'aborder quelqu'un, le dimanche soir un peu vide, la joie d'une vraie conversation, le soulagement d'être compris), pour qu'il se reconnaisse et ait envie de glisser jusqu'à la fin. Jamais racoleur, jamais culpabilisant ni paternaliste. Chaque slide se lit en trois secondes.

Règle absolue de fidélité : tu reformules, tu n'ajoutes rien. Aucun fait, chiffre, pourcentage, âge, étude, citation ou exemple qui ne figure pas dans l'article. Un chiffre repris l'est exactement. Si l'article ne permet pas un format, choisis-en un autre plutôt que d'inventer.

Structure :
- hook : accroche de couverture, 70 caractères au plus, qui touche une émotion ou une situation vécue (pas le titre recopié) ; subtitle : une phrase de 150 caractères au plus qui dit de quoi parle l'article.
- slides : 4 à 6 slides intermédiaires, dans l'ordre de lecture qui crée le plus d'envie de continuer, avec au moins une de chacun de ces formats : « contrast », « list », « quote ». Formats :
  - stat : si l'article cite un chiffre sourcé frappant, mets-le en avant (une seule fois). value = le chiffre tel qu'écrit dans l'article, court (« 1 sur 5 », « 21 % ») ; text = ce qu'il signifie pour le lecteur, 110 caractères au plus ; source = le nom de la source tel qu'il apparaît dans l'article. Jamais de chiffre sans source citée dans l'article.
  - contrast : idée reçue contredite par l'article. myth = l'idée reçue formulée comme on l'entend (100 caractères au plus, sans guillemets) ; reality = ce que dit l'article (120 caractères au plus).
  - list : title = 40 caractères au plus ; items = 2 à 4 éléments de 60 caractères au plus chacun, repris des conseils ou points de l'article.
  - quote : une seule grande phrase à retenir, qui touche (110 caractères au plus), dans text.
  - statement : un recadrage en une ou deux phrases courtes (130 caractères au plus) dans text ; highlight = un mot ou groupe de mots de text à mettre en couleur (ou "").
  - scene : un moment fort de l'article raconté comme une scène vécue. title = 60 caractères au plus ; text = 140 caractères au plus.
  Pour les champs sans objet dans un format, renvoie "" (ou [] pour items).
- imagePrompt, pour CHAQUE slide (une partie seulement sera illustrée, une image tous les deux écrans) : description en anglais d'une photo qui illustre précisément CETTE slide et son émotion (pas l'article en général), jamais la même scène que celle d'une autre slide. Une vraie scène de vie, lumière chaude et cinématographique, couleurs vives, faible profondeur de champ, l'émotion portée par les gestes, les postures, les regards échangés et la lumière. ${ILLUSTRATION_CHARTER}
- ctaHeadline : 40 caractères au plus, qui invite à passer à l'action en lien avec le sujet ; ctaDetail : 110 caractères au plus sur les soirées Nūr Meet, sans promesse chiffrée ; ctaImagePrompt : description en anglais d'une photo chaleureuse de rencontre en petit comité, selon la même charte.
- caption : légende Instagram, ${CAPTION_RULES}

Ne nomme jamais une religion ou une origine, pas de markdown, pas d'emoji dans les slides.`;

const carouselText = (description: string) => ({ type: "string", description });
const carouselTool: Anthropic.Tool = {
  name: "submit_carousel",
  description: "Envoie le carrousel Instagram terminé.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["hook", "subtitle", "slides", "ctaHeadline", "ctaDetail", "ctaImagePrompt", "caption"],
    properties: {
      hook: carouselText("Accroche de couverture"),
      subtitle: carouselText("Phrase sous l'accroche"),
      slides: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "title", "text", "items", "myth", "reality", "highlight", "value", "source", "imagePrompt"],
          properties: {
            kind: { type: "string", enum: ["contrast", "statement", "list", "quote", "scene", "stat"] },
            title: carouselText("Titre (list, scene)"),
            text: carouselText("Texte (quote, statement, scene)"),
            items: { type: "array", items: { type: "string" }, description: "Éléments (list)" },
            myth: carouselText("Idée reçue (contrast)"),
            reality: carouselText("Ce que dit l'article (contrast)"),
            highlight: carouselText("Mot à mettre en couleur (statement)"),
            value: carouselText("Chiffre tel qu'écrit dans l'article (stat)"),
            source: carouselText("Source du chiffre, citée dans l'article (stat)"),
            imagePrompt: carouselText("Description en anglais de la photo de cette slide")
          }
        }
      },
      ctaHeadline: carouselText("Titre de la slide finale"),
      ctaDetail: carouselText("Phrase de la slide finale"),
      ctaImagePrompt: carouselText("Description en anglais de la photo de la slide finale"),
      caption: carouselText("Légende Instagram")
    }
  }
};

export function createAIProvider(apiKey?: string): AIProvider {
  return apiKey ? new AnthropicAIProvider(apiKey) : new LocalAIProvider();
}
