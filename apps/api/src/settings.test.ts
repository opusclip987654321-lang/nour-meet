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
    await updateSetting(fakePrisma([]), "SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE", 14);
    expect(getSetting("SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE")).toBe(14);
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("un autre processus relit la base dès le message, sans redémarrage", async () => {
    let deliver: (message: unknown) => void = () => {};
    settingsChannel.subscribe = onMessage => { deliver = onMessage; return () => {}; };
    const rows = [{ key: "SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE", value: 7 }];
    const prisma = fakePrisma(rows);
    await loadSettings(prisma);
    const stop = watchSettings(prisma, () => {});
    expect(getSetting("SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE")).toBe(7);
    rows[0].value = 21; // modifié en base par un autre processus
    deliver({ type: SETTINGS_CHANGED_MESSAGE });
    await vi.waitFor(() => expect(getSetting("SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE")).toBe(21));
    stop();
  });

  it("refuse une valeur hors des bornes du réglage", async () => {
    await expect(updateSetting(fakePrisma([]), "SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE", -3)).rejects.toThrow();
  });
});
