export function normalizePhoneNumber(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  const french = /^0\d{9}$/.test(international) ? `+33${international.slice(1)}` : international;
  const withPrefix = /^33\d{9}$/.test(french) ? `+${french}` : french;

  if (!/^\+[1-9]\d{7,14}$/.test(withPrefix)) {
    throw Object.assign(new Error("Numéro de téléphone invalide. Utilisez par exemple +33612345678."), { statusCode: 400 });
  }
  return withPrefix;
}
