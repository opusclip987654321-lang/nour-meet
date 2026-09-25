# Stripe en mode test, en local

Nūr Meet n'a **aucun système de paiement maison** : participants et restaurateurs paient par Stripe.
En local, on utilise le **vrai mode test Stripe** — mêmes écrans, mêmes webhooks qu'en production,
mais aucun argent ne circule. L'API refuse d'ailleurs de préparer les formules avec une clé qui
n'est pas une clé de test (`sk_test_…`).

## 1. Variables d'environnement (fichier `.env` à la racine, jamais commité)

| Variable | Où la trouver | Exposée au navigateur ? |
|---|---|---|
| `STRIPE_SECRET_KEY` | Dashboard Stripe → mode test → Développeurs → Clés API (`sk_test_…`) | Non, serveur uniquement |
| `STRIPE_WEBHOOK_SECRET` | Affiché par `stripe listen` (`whsec_…`), voir étape 3 | Non, serveur uniquement |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Même page (`pk_test_…`) | **Oui, par conception** : la clé publiable ne permet que d'afficher le formulaire de carte Stripe Elements, jamais de débiter ni de lire des données |

## 2. Préparer les formules restaurateur (une fois par compte Stripe de test)

```bash
export DATABASE_URL="postgresql://…"          # la base locale
STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup-test-plans -w @nour/api
```

Le script crée (ou retrouve) un produit et deux prix — mensuel et annuel — par formule active, puis
enregistre leurs identifiants sur la table `Plan`. Il est rejouable sans créer de doublon.

## 3. Relayer les webhooks vers l'API locale

```bash
stripe login                                   # une fois
stripe listen --forward-to localhost:4000/webhooks/stripe
```

Copier le `whsec_…` affiché dans `STRIPE_WEBHOOK_SECRET`, puis redémarrer l'API. Événements traités :
`payment_intent.succeeded` / `payment_intent.payment_failed` (billets), `checkout.session.completed`,
`customer.subscription.updated` / `.deleted`, `invoice.payment_succeeded` (abonnements).

Sans webhook, l'espace abonnement relit malgré tout l'état réel chez Stripe au retour de Checkout
(`POST /restaurants/me/subscription/sync`) : l'écran n'affiche jamais une formule non confirmée.

## 4. Cartes de test

Date d'expiration future quelconque, CVC quelconque, code postal quelconque.

| Carte | Résultat |
|---|---|
| `4242 4242 4242 4242` | Paiement accepté |
| `4000 0025 0000 3155` | Authentification 3-D Secure demandée (accepter dans la fenêtre de test) |
| `4000 0000 0000 9995` | Refusée (fonds insuffisants) |
| `4000 0000 0000 0341` | Enregistrée, mais échec au premier prélèvement (utile pour tester un abonnement « Paiement en échec ») |

## 5. Parcours à tester

**Participant** — compte `+33600000042` « Paiement en attente » (code SMS `123456` en mode simulé) :
Mon espace → Réservations → « Payer 35,00 € » (un seul bouton par carte) → accepter les CGV → carte `4242…` → le webhook
confirme : statut « Place confirmée », billet QR dans « Mes billets », notification cliquable.

**Restaurateur** — compte `+33600000002` (Maison Amana) : Mon établissement → Abonnement →
« Choisir cette formule » → Stripe Checkout → carte `4242…` → retour sur le site : formule affichée
« Offre actuelle » avec son statut Stripe (essai, actif…).
- Standard → Premium : « Changer de formule » → confirmation → passage **immédiat**, le prorata est
  facturé tout de suite (visible dans Dashboard Stripe → Factures).
- Premium → Standard : « Changer de formule » → la formule actuelle reste jusqu'à l'échéance, la date
  de bascule est affichée ; « Conserver Premium » annule le changement programmé.
- Pour vérifier la bascule sans attendre un mois : Dashboard Stripe (test) → Horloges de test
  (*test clocks*), ou `stripe trigger customer.subscription.updated`.

**Nouveau restaurateur, parcours en 3 étapes** (décision v2 §5) — créer un compte participant, puis :
1. « Devenir restaurateur » → fiche + au moins une photo → « Envoyer ma demande » : restaurant en attente.
2. « Créer mon premier événement » (`/restaurant/premier-evenement`) : le brouillon est enregistré, rien
   n'est publié.
3. « Choisir mon abonnement » → Checkout → carte `4242…` : au webhook `checkout.session.completed`,
   l'établissement est approuvé, le compte devient restaurateur et le brouillon passe **en attente de
   validation** (jamais publié automatiquement). Avec `4000 0000 0000 9995` (refus) ou une session
   abandonnée, rien ne change : le restaurant reste en attente.

**Carte refusée** : `4000 0000 0000 9995` → message d'erreur de Stripe dans le formulaire, aucune place
réservée ni abonnement activé. **3-D Secure** : `4000 0025 0000 3155` → valider dans la fenêtre de test.

**Aide-mémoire à l'écran** : en développement local uniquement (`npm run dev` / Vite), un encadré
« Développement : cartes de test Stripe » apparaît sous le formulaire de paiement et sous les formules
d'abonnement. Il n'existe pas dans le build de production (`import.meta.env.DEV`).

**Événement de démonstration** (`isDemo`) : le paiement est refusé par l'API avec le message
« Cet événement n'est actuellement pas réservable » — aucun PaymentIntent n'est créé.

## Bon à savoir

- Pour un abonnement souscrit via Stripe, **Stripe fait foi** : une modification manuelle du statut
  depuis Administration → Restaurateurs est écrasée au prochain webhook ou à la prochaine
  resynchronisation. Pour bloquer un restaurateur, suspendre l'établissement (statut `SUSPENDED`).
- Un second paiement Checkout pour un établissement déjà abonné n'écrase jamais l'abonnement en
  cours : les administrateurs reçoivent une notification « Double abonnement Stripe à régulariser ».
