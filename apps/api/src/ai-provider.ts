// Interface de fournisseur IA abstraite pour le blog (§18) : brouillons et propositions sociales
// uniquement, jamais de publication automatique — voir AppSetting AI_BLOG_GENERATION_MODE
// (toujours "DRAFT_ONLY" aujourd'hui) et le circuit de validation humaine dans index.ts. Aucune clé
// de fournisseur payant n'est configurée dans ce projet : seule l'implémentation locale existe pour
// l'instant, mais l'abstraction permet d'en brancher une réelle plus tard sans changer les routes.
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
export interface AIProvider {
  readonly mode: "local" | "external";
  generateDraft(topic: string, category: string): Promise<ArticleDraft>;
  generateSocialCopy(article: { title: string; excerpt: string | null; slug: string }): Promise<SocialCopyProposal[]>;
}

// Génération locale, sans appel externe ni coût : produit un brouillon structuré à partir du sujet
// donné, toujours à compléter et valider par un administrateur avant tout passage en revue.
export class LocalAIProvider implements AIProvider {
  readonly mode = "local" as const;

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
      { platform: "Instagram", text: `${article.title} ✨ ${base} — lien dans la bio.` },
      { platform: "Facebook", text: `${article.title}\n\n${base}\n\nÀ lire sur le blog Nūr Meet.` },
      { platform: "TikTok", text: `${article.title} — on vous en parle sur le blog Nūr Meet.` }
    ];
  }
}

export function createAIProvider(): AIProvider {
  return new LocalAIProvider();
}
