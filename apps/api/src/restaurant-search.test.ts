import { describe, expect, it } from "vitest";
import { searchRestaurants } from "./services/restaurant-search.js";

// Autocomplétion restaurateur (v3 §6.1) : réponse de l'API publique validée champ par champ.
const reply = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as unknown as typeof fetch;

describe("autocomplétion des restaurants", () => {
  it("préfère l’enseigne, déduit le quartier parisien et écarte les établissements fermés ou incomplets", async () => {
    const results = await searchRestaurants("chez karim", reply({ results: [{ nom_complet: "SARL KARIM ET FILS", matching_etablissements: [
      { siret: "12345678900011", adresse: "12 RUE DE LA ROQUETTE 75011 PARIS", code_postal: "75011", libelle_commune: "PARIS", latitude: "48.85", longitude: "2.37", liste_enseignes: ["CHEZ KARIM"], etat_administratif: "A" },
      { siret: "12345678900029", adresse: "3 RUE X 75011 PARIS", code_postal: "75011", libelle_commune: "PARIS", etat_administratif: "F" },
      { siret: "123", adresse: "sans siret valide" }
    ] }] }));
    expect(results).toEqual([{ name: "Chez Karim", legalName: "Sarl Karim Et Fils", siret: "12345678900011", address: "12 Rue De La Roquette 75011 Paris", postalCode: "75011", city: "Paris", district: "Paris 11e", latitude: 48.85, longitude: 2.37 }]);
  });

  it("signale une panne par une erreur (convertie en liste vide par la route)", async () => {
    await expect(searchRestaurants("abc", reply({}, false))).rejects.toThrow("indisponible");
  });
});
