import QRCode from "qrcode";

// QR codes are pure functions of their code string (ticket code / profile share code),
// which never change once issued — regenerating the same PNG on every GET wastes CPU
// on the event loop under load. Cache the data URL the first time it's built.
const cache = new Map<string, string>();
const MAX_ENTRIES = 20_000;

export async function cachedQrDataUrl(code: string): Promise<string> {
  const cached = cache.get(code);
  if (cached) return cached;
  const dataUrl = await QRCode.toDataURL(code);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(code, dataUrl);
  return dataUrl;
}
