import { ReactNode } from "react";

// Documents juridiques — préparation à la mise en production (2026-09). Ce sont des PROJETS DE
// TEXTE, jamais des textes validés : chaque page affiche son propre bandeau et sa propre liste
// d'informations manquantes. Aucune identité de société, aucun numéro d'immatriculation, aucune
// adresse et aucune règle contractuelle n'a été inventée ici — tout ce qui est présenté comme un
// fait décrit un mécanisme réellement implémenté dans le code (vérifiable), jamais une supposition.
// Rien de tout ceci ne doit être considéré comme un avis juridique : une validation par un
// professionnel du droit reste nécessaire avant toute ouverture commerciale au public.

const DraftBanner = ({ missing }: { missing: string[] }) => (
  <div className="notice error" style={{ marginBottom: 30 }}>
    <b>⚠️ PROJET DE TEXTE — À COMPLÉTER ET À VALIDER AVANT TOUTE OUVERTURE COMMERCIALE AU PUBLIC.</b>
    <p style={{ marginTop: 10 }}>Ce document n'a pas de valeur légale tant qu'il n'a pas été relu et validé (idéalement par un professionnel du droit). Informations manquantes, à fournir avant publication :</p>
    <ul style={{ marginTop: 6 }}>{missing.map(m => <li key={m}>{m}</li>)}</ul>
  </div>
);

const LegalPage = ({ title, missing, children }: { title: string; missing: string[]; children: ReactNode }) => (
  <div className="page" style={{ maxWidth: 900 }}>
    <span className="eyebrow">DOCUMENT JURIDIQUE — PROJET</span>
    <h1>{title}</h1>
    <DraftBanner missing={missing} />
    <div style={{ display: "grid", gap: 18, color: "#ccc", lineHeight: 1.7 }}>{children}</div>
  </div>
);

export function MentionsLegales() {
  return <LegalPage title="Mentions légales" missing={[
    "Dénomination sociale, forme juridique et capital social de la société éditrice",
    "Numéro SIRET/SIREN et ville du greffe d'immatriculation (RCS)",
    "Numéro de TVA intracommunautaire",
    "Adresse du siège social",
    "Nom du directeur de la publication",
    "Coordonnées de contact (e-mail et/ou adresse postale) pour toute réclamation",
    "Coordonnées exactes de l'hébergeur à reprendre depuis la page officielle d'OVHcloud au moment de la publication (raison sociale, adresse, téléphone) — ne pas les recopier d'une source non vérifiée à cette date"
  ]}>
    <section>
      <h2>Éditeur du site</h2>
      <p>[DÉNOMINATION SOCIALE], [FORME JURIDIQUE], au capital de [MONTANT] €, immatriculée sous le numéro [SIRET] au RCS de [VILLE], dont le siège social est situé [ADRESSE COMPLÈTE]. Directeur de la publication : [NOM].</p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>Pour toute question relative au site ou au service, écrire à [ADRESSE E-MAIL DE CONTACT].</p>
    </section>
    <section>
      <h2>Hébergement</h2>
      <p>Le site nourmeet.com et l'application associée sont hébergés par OVHcloud (OVH SAS), [coordonnées exactes à reprendre sur ovhcloud.com au moment de la publication].</p>
    </section>
    <section>
      <h2>Propriété intellectuelle</h2>
      <p>L'ensemble des éléments du site (textes, visuels, logo, charte graphique) est protégé par le droit de la propriété intellectuelle. Toute reproduction non autorisée est interdite.</p>
    </section>
  </LegalPage>;
}

export function CGU() {
  return <LegalPage title="Conditions générales d'utilisation" missing={[
    "Identité complète de l'éditeur (voir mentions légales)",
    "Politique d'âge minimum : décision à confirmer — l'âge n'est aujourd'hui vérifié par aucun contrôle technique à l'inscription (seuls des bornes d'âge facultatives peuvent être fixées événement par événement par l'organisateur)",
    "Loi applicable et juridiction compétente en cas de litige",
    "Procédure et contact pour signaler un contenu ou un comportement abusif en dehors de l'outil de signalement intégré",
    "Modalités précises et délai de préavis en cas de modification des présentes CGU"
  ]}>
    <section>
      <h2>Objet</h2>
      <p>Nūr Meet met en relation des participants lors d'événements physiques (rencontres de type « speed dating » et soirées de réseautage professionnel) organisés par Nūr Meet ou par des établissements partenaires.</p>
    </section>
    <section>
      <h2>Création de compte</h2>
      <p>La création d'un compte se fait par numéro de téléphone, vérifié par un code à usage unique envoyé par SMS. Une adresse e-mail peut être ajoutée facultativement au profil, notamment pour recevoir une copie des notifications importantes (billet, confirmation, rappel).</p>
    </section>
    <section>
      <h2>Parcours de participation</h2>
      <p>Deux parcours coexistent selon le type d'événement :</p>
      <ul>
        <li><b>Speed dating :</b> nécessite un profil validé lors d'un entretien de sélection (une seule démarche, valable pour tous les événements de ce type) et un questionnaire privé de 7 questions, jamais transmis à l'établissement organisateur ni à un autre participant.</li>
        <li><b>Réseautage professionnel :</b> inscription directe sans entretien préalable ; un questionnaire professionnel facultatif peut être renseigné après confirmation de la place, à titre purement informatif pour l'organisation de la soirée.</li>
      </ul>
      <p>Dans tous les cas, une candidature n'emporte jamais réservation définitive d'une place : celle-ci n'est acquise qu'après confirmation du paiement (ou confirmation immédiate pour un événement gratuit).</p>
    </section>
    <section>
      <h2>Mise en relation après l'événement</h2>
      <p>Après un événement, chaque participant peut demander à entrer en contact avec un autre participant présent ; l'échange de messages ne s'ouvre qu'après acceptation réciproque.</p>
    </section>
    <section>
      <h2>Signalement et modération</h2>
      <p>Tout comportement ou contenu inapproprié peut être signalé depuis l'application. Les signalements sont examinés par un modérateur ou un administrateur, qui peut suspendre un compte en cas de manquement grave aux présentes conditions.</p>
    </section>
    <section>
      <h2>Suppression de compte</h2>
      <p>Un participant peut demander la suppression de son compte à tout moment. Les données d'identification directe (nom, coordonnées, réponses de questionnaire) sont alors anonymisées ; les données liées à une transaction financière (paiement, facturation) sont conservées pour la durée légalement requise, sans lien identifiable avec la personne au-delà de ce qui reste strictement nécessaire.</p>
    </section>
  </LegalPage>;
}

export function CGV() {
  return <LegalPage title="Conditions générales de vente" missing={[
    "Identité complète du vendeur (voir mentions légales) et régime de TVA applicable",
    "Confirmation par un professionnel du droit de l'exception au délai de rétractation applicable aux prestations de loisirs fournies à une date déterminée (article L221-28 du Code de la consommation), avant de s'y référer auprès des clients",
    "Procédure de médiation de la consommation (nom et coordonnées du médiateur, obligatoires pour toute entreprise vendant à des consommateurs)",
    "Politique de facturation (facture systématique ou sur demande, mentions obligatoires)"
  ]}>
    <section>
      <h2>Billets d'événement</h2>
      <p>Les prix affichés sont en euros, toutes taxes comprises. Le paiement s'effectue par carte bancaire via le prestataire Stripe au moment de la confirmation de place ; Nūr Meet ne stocke jamais les coordonnées bancaires. Lorsqu'un événement est proposé gratuitement, la place est confirmée immédiatement, sans paiement.</p>
    </section>
    <section>
      <h2>Politique d'annulation et de remboursement</h2>
      <p>Un participant peut annuler sa participation gratuitement jusqu'à 24 heures avant le début de l'événement : le remboursement intégral est alors automatique. Passé ce délai, aucun remboursement n'est dû de plein droit.</p>
      <p>Si l'organisateur annule un événement déjà publié, les places déjà réglées sont intégralement remboursées automatiquement. Un événement publié ne peut pas être simplement déplacé à une autre date : seule son annulation, suivie le cas échéant de la création d'un nouvel événement, est possible.</p>
    </section>
    <section>
      <h2>Liste d'attente</h2>
      <p>Lorsqu'un événement est complet, un désistement libère la place à l'ensemble des personnes inscrites sur liste d'attente en même temps : elle revient à la première personne qui finalise effectivement son paiement.</p>
    </section>
    <section>
      <h2>Abonnements des établissements partenaires</h2>
      <p>Les établissements souhaitant organiser leurs propres événements souscrivent un abonnement mensuel ou annuel (formules « Standard » et « Premium »), précédé d'une période d'essai gratuite de 7 jours. Un abonnement peut être résilié à tout moment ; la résiliation prend effet à la fin de la période déjà payée, sans remboursement au prorata de la période en cours.</p>
    </section>
  </LegalPage>;
}

export function Confidentialite() {
  return <LegalPage title="Politique de confidentialité" missing={[
    "Identité du responsable de traitement (voir mentions légales)",
    "Coordonnées d'un contact dédié pour l'exercice des droits (délégué à la protection des données ou, à défaut, contact désigné)",
    "Durées de conservation précises et arrêtées pour chaque catégorie de donnée non déjà encadrée dans le code (notamment les messages entre utilisateurs et les signalements)",
    "Confirmation par un professionnel du droit que le fonctionnement décrit ci-dessous respecte le RGPD dans son ensemble, au-delà des mécanismes déjà mis en place"
  ]}>
    <section>
      <h2>Données collectées</h2>
      <ul>
        <li><b>Compte :</b> numéro de téléphone (obligatoire), adresse e-mail (facultative), nom affiché.</li>
        <li><b>Profil :</b> date de naissance, ville, profession, centres d'intérêt, présentation libre, photo de profil, catégorie homme/femme (utilisée uniquement pour équilibrer les places par catégorie sur les événements qui le prévoient).</li>
        <li><b>Questionnaires de participation :</b> réponses au questionnaire privé de sélection (speed dating, jamais communiquées à un tiers) et réponses facultatives au questionnaire professionnel (réseautage, visibles par l'organisateur de la soirée concernée).</li>
        <li><b>Messagerie :</b> messages échangés entre deux participants après mise en relation acceptée.</li>
        <li><b>Signalements :</b> contenu d'un signalement déposé contre un autre utilisateur.</li>
        <li><b>Paiement :</b> aucune coordonnée bancaire n'est stockée par Nūr Meet ; ces données sont traitées directement par Stripe.</li>
        <li><b>Établissements partenaires :</b> raison sociale, SIRET, nom du gérant, adresse et téléphone professionnels.</li>
        <li><b>Mesure d'audience :</b> lorsqu'elle est activée (désactivée par défaut), un identifiant anonyme, la page consultée et la source de visite — jamais de donnée directement identifiante, conservée au maximum 13 mois.</li>
      </ul>
    </section>
    <section>
      <h2>Sous-traitants et destinataires</h2>
      <ul>
        <li><b>Stripe</b> (paiement par carte).</li>
        <li><b>Twilio</b> (envoi du code de vérification par SMS).</li>
        <li><b>Resend</b> (envoi des e-mails transactionnels — confirmations, billets), lorsqu'il est configuré.</li>
        <li><b>Sentry</b> (suivi technique des erreurs du service), lorsqu'il est configuré : configuré pour ne jamais recevoir de mot de passe, de jeton de connexion, de moyen de paiement ni d'identité précise de l'utilisateur.</li>
        <li><b>OVHcloud</b> (hébergement des serveurs, France).</li>
      </ul>
    </section>
    <section>
      <h2>Conservation et suppression</h2>
      <p>La suppression d'un compte anonymise les données d'identification et les réponses de questionnaire ; les données liées à un paiement sont conservées pour la durée exigée par les obligations comptables et fiscales, sans lien identifiable au-delà de ce qui reste strictement nécessaire.</p>
    </section>
    <section>
      <h2>Vos droits</h2>
      <p>Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement (sous la forme d'une anonymisation, voir ci-dessus), de portabilité et d'opposition sur vos données. Pour l'exercer : [CONTACT À DÉFINIR].</p>
    </section>
  </LegalPage>;
}

export function Cookies() {
  return <LegalPage title="Gestion des cookies et du consentement" missing={[
    "Décision et validation juridique avant toute activation de la mesure d'audience : le mécanisme est conçu pour rester dans le cadre de l'exemption de consentement de la CNIL (finalité strictement statistique, données anonymisées, opposition possible, conservation limitée), mais cela doit être confirmé avant activation, avec un bandeau de consentement si le format retenu venait à en sortir",
    "Politique définitive sur l'usage éventuel, à l'avenir, d'outils publicitaires ou de traceurs tiers (aucun n'existe actuellement dans le code)"
  ]}>
    <section>
      <h2>Ce que nous utilisons aujourd'hui</h2>
      <p>Le site n'utilise aucun cookie ni traceur publicitaire. Les seuls mécanismes de stockage utilisés dans le navigateur sont :</p>
      <ul>
        <li><b>Jeton de connexion</b> (stockage local du navigateur) : strictement nécessaire pour rester connecté à son compte, jamais partagé avec un tiers.</li>
        <li><b>Attribution d'un lien de parrainage</b> (mémoire de session, effacée à la fermeture de l'onglet) : retient temporairement qui a partagé un lien d'événement, pour créditer correctement le partage.</li>
        <li><b>Mesure d'audience anonyme</b> (désactivée par défaut) : si elle est activée, un identifiant anonyme est déposé pour compter les visites de façon statistique, sans lien avec l'identité de la personne.</li>
      </ul>
      <p>Les mécanismes strictement nécessaires au fonctionnement du service (connexion, panier de paiement en cours) ne requièrent pas de consentement préalable au titre de la réglementation ePrivacy. Si la mesure d'audience est un jour activée dans des conditions qui sortiraient du cadre de l'exemption CNIL, un bandeau de consentement sera ajouté avant son activation, jamais après.</p>
    </section>
  </LegalPage>;
}
