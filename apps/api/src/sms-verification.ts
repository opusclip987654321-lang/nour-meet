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

// Codes d'erreur Twilio (twilio.com/docs/api/errors) traduits en un message utile : un refus
// générique « impossible d'envoyer » masquait en production une erreur de configuration du compte
// (identifiants, service Verify, pays non autorisé, compte d'essai), impossible à diagnostiquer.
// Une erreur de configuration est une panne côté plateforme (503, journalisée), pas une faute
// de l'utilisateur.
export function describeTwilioFailure(httpStatus: number, code?: number): { statusCode: number; message: string } {
  if (httpStatus === 429 || code === 60203 || code === 60202) return { statusCode: 429, message: "Trop de demandes de SMS. Réessayez plus tard." };
  if (code === 60200 || code === 21211 || code === 21614) return { statusCode: 400, message: "Ce numéro de téléphone n’est pas valide. Vérifiez-le (ex. +33612345678)." };
  if (code === 60205) return { statusCode: 400, message: "Ce numéro ne peut pas recevoir de SMS (ligne fixe ?). Utilisez un numéro de mobile." };
  if (code === 60410 || code === 60605 || code === 21408) return { statusCode: 400, message: "L’envoi de SMS vers ce pays n’est pas encore ouvert." };
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404 || httpStatus >= 500 || code === 20003 || code === 20404 || code === 21608 || code === 60223)
    return { statusCode: 503, message: "Le service SMS est temporairement indisponible. Réessayez dans quelques instants." };
  return { statusCode: 400, message: "Impossible d’envoyer ou de vérifier ce code SMS." };
}

type TwilioConfig ={ accountSid: string; authToken: string; serviceSid: string };

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
      const { statusCode, message } = describeTwilioFailure(response.status, data.code);
      throw Object.assign(new Error(message), { statusCode, providerStatus: response.status, providerCode: data.code, providerMessage: data.message });
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
      // Twilio répond 404 (20404) quand aucune vérification n'est en attente (code expiré ou déjà
      // utilisé) : c'est un code refusé pour l'utilisateur, pas une panne du service.
      const failure = error as { statusCode?: number; providerStatus?: number; providerCode?: number };
      if (failure.statusCode === 400 || failure.providerStatus === 404 || failure.providerCode === 20404) return false;
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
