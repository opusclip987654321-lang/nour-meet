import { describe, expect, it } from "vitest";
import { routeFromPath } from "./links";

describe("liens des notifications et des articles vers les écrans de l'application", () => {
  it("mène à l'inscription, au billet ou à l'événement précis, comme sur le site", () => {
    expect(routeFromPath("/dashboard?tab=reservations&application=app1")).toEqual({ name: "espace", tab: "reservations", focus: "app1" });
    expect(routeFromPath("/dashboard?tab=tickets&reservation=res1")).toEqual({ name: "espace", tab: "tickets", focus: "res1" });
    expect(routeFromPath("/events/diner-connexions")).toEqual({ name: "events", slug: "diner-connexions" });
    expect(routeFromPath("/events?category=Speed%20dating")).toEqual({ name: "events", category: "Speed dating" });
    expect(routeFromPath("/dashboard?tab=interview")).toEqual({ name: "espace", tab: "interview" });
    expect(routeFromPath("/dashboard?tab=contacts")).toEqual({ name: "messages" });
    expect(routeFromPath("/restaurant?tab=subscription")).toEqual({ name: "restaurant", tab: "subscription" });
    expect(routeFromPath("/blog/un-article")).toEqual({ name: "blog", slug: "un-article" });
  });
  it("ouvre dans le navigateur un chemin sans écran mobile, et retombe sur l'accueil sans chemin", () => {
    expect(routeFromPath("/admin/events?highlight=e1")).toEqual({ name: "web", path: "/admin/events?highlight=e1" });
    expect(routeFromPath(null)).toEqual({ name: "home" });
    expect(routeFromPath("https://exemple.com")).toEqual({ name: "home" });
  });
});
