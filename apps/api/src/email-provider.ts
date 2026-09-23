export interface EmailProvider {
  readonly mode: "mock" | "resend";
  send(to: string, subject: string, body: string): Promise<void>;
}

// Aucun envoi réel : reflète honnêtement qu'aucun fournisseur d'e-mail n'est configuré.
export class MockEmailProvider implements EmailProvider {
  readonly mode = "mock" as const;
  async send(_to: string, _subject: string, _body: string): Promise<void> {}
}

export class ResendEmailProvider implements EmailProvider {
  readonly mode = "resend" as const;
  constructor(private readonly apiKey: string, private readonly from: string, private readonly http: typeof fetch = fetch) {}

  async send(to: string, subject: string, body: string): Promise<void> {
    const response = await this.http("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to, subject, text: body })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend a refusé l’envoi (${response.status}) : ${detail}`);
    }
  }
}

export function createEmailProvider(config: { apiKey?: string; from?: string; fromName?: string }): EmailProvider {
  if (config.apiKey && config.from) {
    const sender = config.fromName ? `${config.fromName} <${config.from}>` : config.from;
    return new ResendEmailProvider(config.apiKey, sender);
  }
  return new MockEmailProvider();
}
