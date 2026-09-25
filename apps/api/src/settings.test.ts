import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { SETTINGS_CHANGED_MESSAGE, getSetting, loadSettings, settingsChannel, updateSetting, watchSettings } from "./settings.js";

// Décision du 2026-09-25 : un réglage modifié par un processus du cluster est appliqué par tous,
// sans redémarrage — l'émetteur prévient les autres (IPC), chacun relit la base.
const fakePrisma = (rows: { key: string; value: unknown }[]) => ({
  appSetting: {
    findMany: vi.fn(async () => rows),
    upsert: vi.fn(async ({ create }: { create: { key: string; value: unknown } }) => { const row = rows.find(r => r.key === create.key); if (row) row.value = create.value; else rows.push(create); return create; })
  }
}) as unknown as PrismaClient;

const realChannel = { ...settingsChannel };
afterEach(() => { Object.assign(settingsChannel, realChannel); });

describe("réglages partagés entre les processus du cluster", () => {
  it("le processus qui enregistre applique la valeur tout de suite et prévient les autres", async () => {
    const broadcast = vi.fn();
    settingsChannel.broadcast = broadcast;
    await updateSetting(fakePrisma([]), "RESTAURANT_TRIAL_DAYS", 14);
    expect(getSetting("RESTAURANT_TRIAL_DAYS")).toBe(14);
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("un autre processus relit la base dès le message, sans redémarrage", async () => {
    let deliver: (message: unknown) => void = () => {};
    settingsChannel.subscribe = onMessage => { deliver = onMessage; return () => {}; };
    const rows = [{ key: "RESTAURANT_TRIAL_DAYS", value: 7 }];
    const prisma = fakePrisma(rows);
    await loadSettings(prisma);
    const stop = watchSettings(prisma, () => {});
    expect(getSetting("RESTAURANT_TRIAL_DAYS")).toBe(7);
    rows[0].value = 21; // modifié en base par un autre processus
    deliver({ type: SETTINGS_CHANGED_MESSAGE });
    await vi.waitFor(() => expect(getSetting("RESTAURANT_TRIAL_DAYS")).toBe(21));
    stop();
  });

  it("refuse une durée d'essai que Stripe n'accepterait pas", async () => {
    await expect(updateSetting(fakePrisma([]), "RESTAURANT_TRIAL_DAYS", 999)).rejects.toThrow();
  });
});
