export type SmsVerificationMode = "mock" | "twilio";

export interface SmsVerificationProvider {
  readonly mode: SmsVerificationMode;
  sendCode(phone: string): Promise<void>;
  checkCode(phone: string, code: string): Promise<boolean>;
}

export class MockSmsVerificationProvider implements SmsVerificationProvider {
  readonly mode = "mock" as const;
  constructor(private readonly code: string) {}
  async sendCode(): Promise<void> {}
  async checkCode(_phone: string, code: string): Promise<boolean> { return code === this.code; }
}

type TwilioConfig = { accountSid: string; authToken: string; serviceSid: string };

export class TwilioVerifyProvider implements SmsVerificationProvider {
  readonly mode = "twilio" as const;
  constructor(private readonly config: TwilioConfig, private readonly http: typeof fetch = fetch) {}

  private async post(endpoint: "Verifications" | "VerificationCheck", values: Record<string, string>) {
    const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(this.config.serviceSid)}/${endpoint}`;
    const response = await this.http(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(values)
    });
    const data = await response.json().catch(() => ({})) as { status?: string; message?: string; code?: number };
    if (!response.ok) {
      const statusCode = response.status === 429 ? 429 : response.status >= 500 ? 503 : 400;
      const message = response.status === 429
        ? "Trop de demandes de SMS. Réessayez plus tard."
        : response.status >= 500
          ? "Le service SMS est temporairement indisponible."
          : "Impossible d’envoyer ou de vérifier ce code SMS.";
      throw Object.assign(new Error(message), { statusCode, providerCode: data.code });
    }
    return data;
  }

  async sendCode(phone: string): Promise<void> {
    await this.post("Verifications", { To: phone, Channel: "sms" });
  }

  async checkCode(phone: string, code: string): Promise<boolean> {
    try {
      const result = await this.post("VerificationCheck", { To: phone, Code: code });
      return result.status === "approved";
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 400) return false;
      throw error;
    }
  }
}

export function createSmsVerificationProvider(config: {
  mode: SmsVerificationMode;
  devCode: string;
  accountSid?: string;
  authToken?: string;
  serviceSid?: string;
}): SmsVerificationProvider {
  if (config.mode === "mock") return new MockSmsVerificationProvider(config.devCode);
  if (!config.accountSid || !config.authToken || !config.serviceSid) throw new Error("Configuration Twilio incomplète");
  return new TwilioVerifyProvider({ accountSid: config.accountSid, authToken: config.authToken, serviceSid: config.serviceSid });
}
