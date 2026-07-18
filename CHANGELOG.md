# Journal des versions — MedConnect

Ce fichier suit les nouveautés et corrections livrées à chaque version.
Affiché dans l'application via `VersionManager` (dialogue de mise à
jour) et l'écran **Paramètres → À propos**.

La source unique de la version en cours est `config/app-version.json` —
ce fichier doit rester cohérent avec elle.

## 2.9.31 — 2026-07-18

### Sécurité
- Isolation entre établissements corrigée sur les lits, admissions, dossiers d'urgence, dossiers de maternité et requêtes IA : un membre du personnel d'un hôpital pouvait créer, modifier ou supprimer ces données pour un AUTRE hôpital — même principe d'isolation déjà en place pour le laboratoire, désormais étendu à ces collections.
- Rendez-vous (mc_appointments) : isolation par établissement et contrôle d'abonnement mobile/desktop ajoutés, alignés sur les consultations/ordonnances/résultats de laboratoire.
- Notifications : les notifications envoyées via un second circuit interne (ex. réception → médecin orienté) restaient illisibles par leur destinataire à cause d'une incohérence de champs — corrigé.
- Affiliation hôpital/personnel : lisible auparavant par tout compte connecté ; restreinte désormais à l'administrateur et au titulaire du document.
- Approbation de nouveau personnel : possible même abonnement expiré ; désormais soumise au même contrôle que les autres actions premium.

### Corrections
- Mode hors-ligne de l'application (PWA installée, y compris Android) totalement cassé depuis l'ajout de la messagerie desktop — corrigé.
- Création d'une fiche patient hors du contexte hôpital desktop : pouvait échouer silencieusement — corrigé.
- Menu du desktop hôpital : un libellé s'affichait littéralement « hd_records » au lieu de « Dossiers médicaux » ; 4 autres libellés restaient toujours en français quelle que soit la langue choisie — corrigés.
- Plusieurs écrans du desktop hôpital (pharmacie, consultations, ordonnances, patients, médecins affiliés) ne vérifiaient les droits qu'au niveau du menu — un contrôle réel a été ajouté à l'affichage.
- Badge de messages non lus : ne redescendait plus après suppression d'un message urgent jamais ouvert.
- Bouton « Retour » pendant la vérification d'une connexion desktop hôpital : pouvait, dans de rares cas, rouvrir le tableau de bord après annulation — corrigé.
- Bouton de transfert patient absent pour un médecin arrivé par le lanceur mobile de l'espace hôpital — corrigé.
- Gestion des lits (ajout, mise en maintenance) non limitée aux rôles prévus — corrigé.

## 2.9.30 — 2026-07-18

- Nouveau : messagerie interne à l'établissement ajoutée au desktop hôpital (absente jusqu'ici, contrairement au mobile) — envoi/réception entre médecin, infirmier(ère), laborantin, réceptionniste, pharmacie et administration hôpital, avec pièce jointe optionnelle vers une fiche patient ou une ordonnance déjà existante (jamais un fichier importé)
- Correctif : les ordonnances/consultations/résultats de laboratoire créés côté desktop hôpital ne sont désormais visibles au médecin/infirmier(ère) sur mobile que si l'abonnement de l'établissement est actif — le contenu créé côté mobile reste toujours visible, sans changement du principe existant

## 2.9.29 — 2026-07-18

- IA médicale : les articles restent affichés en français par défaut (titre et résumé traduits) quand une synthèse IA est configurée, avec le texte original toujours accessible (« Voir le texte original ») — sans clé configurée, message clair au lieu d'une traduction inventée
- IA médicale : une recherche courte sur un seul médicament (ex. « quinine ») est désormais triée par pertinence clinique — les études cliniques/humaines apparaissent avant la chimie analytique ou l'expérimentation animale, sans qu'aucune étude ne soit supprimée
- IA médicale : filtres (études humaines, essais cliniques, revues systématiques, effets indésirables, interactions, résistance, année) et nettoyage des balises HTML brutes que renvoyait parfois Europe PMC dans les résumés

## 2.9.28 — 2026-07-18

- Correctif Laboratoire (desktop hôpital) : le bouton « + Nouvelle demande » ouvrait une fenêtre affichée SOUS le tableau de bord (invisible à l'écran, clic apparemment sans effet) — la fenêtre passe désormais au-dessus, se ferme par la croix, la touche Échap ou un clic en dehors
- Correctif sécurité : le bouton « + Nouvelle demande » et la création de demandes d'analyses étaient accessibles à tous les rôles, y compris au laborantin lui-même — réservés désormais au médecin, à l'infirmier(ère) et à l'administration hospitalière, vérifié à l'affichage ET au moment de l'action, y compris côté serveur (règles Firestore)
- Correctif : la prise en charge et la saisie de résultat n'étaient plus limitées par établissement — un laborantin pouvait modifier une demande ou un résultat d'un AUTRE hôpital ; l'accès est désormais strictement limité à l'établissement d'affiliation, avec des transitions de statut contrôlées (impossible de revenir en arrière ou de sauter une étape)
- Correctif : la saisie d'un résultat de laboratoire effectuait 3 écritures Firestore séparées — un échec après la première pouvait clôturer une demande sans résultat associé (invisible pour le médecin et le patient) ; les 3 écritures sont désormais atomiques (tout ou rien)
- Correctif : un résultat demandé par un(e) infirmier(ère) ne parvenait qu'au médecin (jamais à l'infirmier(ère) demandeur) et pouvait confondre son identifiant avec celui du médecin responsable — les deux rôles reçoivent désormais correctement le résultat, sans confusion d'identité
- Correctif : le rôle Laboratoire n'était notifié d'AUCUNE nouvelle demande d'analyse en temps réel — corrigé
- Interface : recherche du patient par numéro MC (cache local puis vérification cloud ciblée), retour visuel et verrou anti double-clic sur tous les boutons du module laboratoire (nouvelle demande, prise en charge, saisie de résultat)

## 2.9.27 — 2026-07-18

- Correctif Laboratoire/Réception : un établissement retrouvé dans Firestore lors de la connexion mais absent du cache local (fusions manquées) empêchait la création de la demande d'affiliation à l'inscription — l'établissement est désormais mis en cache localement dès sa lecture, sans jamais écraser le personnel déjà connu ni écrire sur Firestore
- Correctif : la demande d'affiliation ne renvoyait plus d'échec exploitable (false silencieux) quand l'établissement n'était pas immédiatement disponible — elle tente désormais une lecture ciblée Firestore, sinon retourne un motif précis (« établissement introuvable ») affiché tel quel au lieu d'un message générique
- Correctif sécurité : la recherche du compte Laboratoire/Réception au moment de la connexion se limitait au premier document trouvé (limit(1)) — un faux document sans identité Firebase pouvait masquer le vrai compte ; la recherche est désormais élargie et filtrée (identité Firebase + rôle + email requis), avec refus explicite ("identités ambiguës") si plusieurs comptes valides coexistent au lieu d'un choix arbitraire
- Correctif : après connexion, le profil Firestore (rôle, statut, identité) est désormais revérifié directement et comparé au compte public local — toute incohérence bloque l'ouverture du tableau de bord au lieu de l'autoriser sur la seule foi du cache
- Correctif : l'affiliation à l'établissement n'était vérifiée que via le cache local du personnel (establishments.staff), pouvant devenir périmé — la connexion consulte désormais directement hospitalMembers et affiliation_requests, avec réparation contrôlée du cache uniquement si Firestore confirme une affiliation approuvée (jamais l'inverse)
- Amélioration : messages d'erreur distincts à la connexion Laboratoire/Réception selon la cause réelle (compte introuvable, en attente de validation, affiliation en attente/refusée, mot de passe incorrect, identité incohérente) au lieu d'un message générique unique
- Interface : retour à l'écran de connexion établissement (au lieu d'un état intermédiaire ambigu) après l'inscription Laboratoire/Réception, avec indication claire de reconnexion ; retour visuel immédiat (bouton verrouillé, étapes affichées) sur les boutons d'inscription et de connexion de ces rôles

## 2.9.26 — 2026-07-17

- Laboratoire/Réception : l'inscription depuis le desktop hôpital exige désormais une identité Firebase réelle de bout en bout — aucun compte n'est plus créé (ni cloud, ni local) si Firebase Authentication échoue ou si Firestore ne confirme pas l'écriture, avec détection des doublons (matricule/email) avant toute création
- Laboratoire/Réception : la demande d'affiliation à l'établissement est désormais créée dès l'inscription (au lieu d'exiger une seconde démarche après validation du compte), et la session est systématiquement nettoyée après l'inscription (jamais de tableau de bord ouvert pour un compte en attente)
- Connexion desktop : messages d'erreur précis selon la cause réelle (compte en attente/refusé/suspendu, affiliation en attente, matricule déjà lié à un autre compte) — un matricule ne peut plus être repris silencieusement par un autre compte
- Administration : les boutons "Approuver"/"Refuser"/"Suspendre" et l'approbation d'affiliation attendent désormais réellement la confirmation Firestore (avec délai maximal) avant d'afficher un succès, se verrouillent contre le double-clic, et ne peuvent plus transformer une demande fantôme (sans compte Firebase) en compte approuvé

## 2.9.25 — 2026-07-17

- Android : vraie mise à jour intégrée à l'application — au lieu d'ouvrir un lien de téléchargement dans le navigateur, l'app télécharge l'APK et ouvre directement l'écran d'installation Android (un seul appui, avec autorisation « sources inconnues » demandée automatiquement si besoin)

## 2.9.24 — 2026-07-15

- IA médicale : la réponse simulée est remplacée par une vraie recherche dans la littérature médicale mondiale (Europe PMC / PubMed) avec articles sourcés et cliquables — et, si l'établissement configure sa propre clé API Claude (stockée uniquement sur son poste), une synthèse en français citant ses sources
- Android : la version affichée par l'application (fiche Android) est alignée sur la version réelle (2.6.0 → 2.9.23) — nécessite de reconstruire l'APK ; le contenu, lui, était déjà à jour (l'APK charge la PWA en ligne)
- Déploiement : nouveau workflow manuel pour publier le miroir Firebase Hosting (medconnect-e81ba.web.app)

## 2.9.23 — 2026-07-14

- Sécurité/facturation : le blocage d'abonnement des workflows desktop (lits, admissions, réception, laboratoire, urgences, maternité, IA médicale) est désormais appliqué côté serveur de façon infalsifiable — un client modifié ne peut plus le contourner en se faisant passer pour un mobile

## 2.9.22 — 2026-07-14

- Interface : verrou anti double-appui ajouté à la connexion administrateur et, après audit, à toutes les actions restantes qui créent des données (consultation, admission, demandes et résultats de laboratoire, rendez-vous, connexion et inscription d'établissement) — plus aucun doublon possible en cas d'appui répété pendant un traitement

## 2.9.21 — 2026-07-14

- Interface : tous les boutons de l'application réagissent désormais visiblement à l'appui et ne peuvent plus déclencher deux fois la même action sur un double appui — protections renforcées sur les actions sensibles (validation/activation administrateur, inscriptions, créations de dossiers)
- Connexion patient : le bouton dit simplement « Se connecter » (au lieu de « Se connecter à mon dossier existant ») et les textes non essentiels ont été allégés
- Inscription : les rôles Laboratoire et Réception (postes desktop hôpital) ne sont plus proposés sur mobile — les résultats labo continuent d'atteindre le patient mobile

## 2.9.20 — 2026-07-13

- Correctif : une sortie d'hospitalisation (ainsi que la clôture d'un passage aux urgences ou d'un dossier de maternité) ne se reflétait pas dans le dossier du patient — la Timeline affichait l'hospitalisation comme toujours en cours. Le statut est désormais synchronisé côté patient (affichage « · Sortie »)

## 2.9.19 — 2026-07-13

- Nettoyage (audit) : arrêt d'écritures Firestore mortes (mc_transfers/transfers depuis la messagerie ciblée, mc_settings depuis les réglages) — des collections sans règles, systématiquement rejetées en silence et jamais relues. Aucun impact fonctionnel (les messages et réglages continuent de fonctionner par leurs vrais chemins)

## 2.9.18 — 2026-07-13

- Sécurité/facturation : l'enregistrement d'un nouveau patient sur desktop est désormais bloqué (message clair) si l'abonnement de l'établissement est expiré — SAUF aux urgences, où l'enregistrement du patient reste toujours possible (le soin d'urgence n'est jamais coupé)
- Correctif : dans le Dashboard admin, un établissement validé mais sans abonnement payé s'affichait « Actif » et le restait après clic sur « Activer » (aucun changement visible) — il affiche désormais « Validé — aucun abonnement actif », et l'activation produit un changement de statut clair

## 2.9.17 — 2026-07-13

- Amélioration : dans le Dashboard admin, un établissement en attente utilise désormais l'option de validation d'inscription existante (qui autorise la connexion), au lieu de l'activation d'abonnement — et cette validation confirme réellement le statut côté serveur avant de l'annoncer

## 2.9.16 — 2026-07-13

- Nettoyage : le filtre « Document » de la Timeline médicale n'était jamais alimenté (purement décoratif) — retiré de la barre de filtres

## 2.9.15 — 2026-07-13

- Correctif : l'activation d'un abonnement hôpital ne confirmait pas réellement la validation de l'établissement (écriture non attendue) — le statut pouvait rester « à valider » et prêter à confusion. La validation est désormais confirmée avant d'annoncer le succès, avec un avertissement clair si elle échoue

## 2.9.14 — 2026-07-13

- Correctif : une inscription d'établissement faite depuis le desktop n'apparaissait pas clairement dans le Dashboard administrateur (elle s'affichait comme « Actif » dans la liste des abonnements, sans signal de nouvelle demande) — les établissements en attente de validation sont désormais remontés en tête, signalés distinctement et comptés dans une bannière

## 2.9.13 — 2026-07-13

- Correctif : l'envoi d'une ordonnance depuis le desktop hôpital n'appliquait aucun contrôle d'abonnement (contrairement aux consultations/ordonnances) — désormais bloqué si l'abonnement de l'établissement est expiré, aussi bien pour l'envoi vers une pharmacie partenaire que pour le dépôt dans l'espace du patient. L'envoi reste toujours possible depuis le mobile.

## 2.9.11 — 2026-07-13

- Correctif : un échec après la création du compte lors d'une inscription hôpital pouvait verrouiller définitivement le candidat (compte orphelin nettoyé automatiquement, comme pour les autres flux d'inscription)

## 2.9.10 — 2026-07-13

- Correctif : un passage aux urgences ou un dossier de grossesse saisi côté desktop hôpital n'apparaissait jamais dans le dossier du patient — désormais synchronisé automatiquement (Timeline médicale, filtres Urgences/Maternité)

## 2.9.9 — 2026-07-13

- Correctif : le filtre "🏥 Hospitalisation" du dossier patient (Timeline médicale) existait déjà mais n'était jamais alimenté — les admissions saisies côté desktop y apparaissent désormais

## 2.9.8 — 2026-07-13

- Correctif : la prise de rendez-vous n'appliquait pas non plus le contrôle d'abonnement desktop (même principe que les consultations/ordonnances) — le champ manquant qui rendait la règle serveur inopérante est désormais posé, et un message clair s'affiche côté interface en cas de blocage

## 2.9.7 — 2026-07-13

- Nettoyage : arrêt d'écritures Firestore mortes (mc_affiliations, jamais lue par l'app) qui étaient rejetées en boucle silencieuse
- Correctif : la suspension d'un compte par l'administrateur ne vérifiait pas que l'écriture cloud avait bien été confirmée (comme pour l'approbation/le rejet)

## 2.9.6 — 2026-07-13

- Correctif : un résultat de laboratoire saisi côté desktop hôpital n'apparaissait jamais dans la vue "Mes analyses" du patient (deux systèmes de laboratoire jusqu'ici déconnectés) — désormais synchronisé automatiquement

## 2.9.5 — 2026-07-13

- Correctif : un échec après la création du compte lors d'une inscription laboratoire/réception pouvait verrouiller définitivement le candidat (compte orphelin nettoyé automatiquement, comme pour les autres rôles professionnels)

## 2.9.4 — 2026-07-13

- Correctif sécurité : la messagerie entre professionnels (boîte de réception, "Nouveau message") n'appliquait jamais le contrôle d'abonnement desktop — désormais soumise au même principe que les consultations/ordonnances (jamais de blocage si un patient est impliqué)

## 2.9.3 — 2026-07-13

- Correctif : le principe "desktop bloqué en écriture si l'abonnement hôpital est expiré, mobile jamais coupé pour le soin courant" n'était en réalité jamais appliqué à la création de consultation/ordonnance — désormais vérifié côté règles serveur et signalé clairement côté interface

## 2.9.2 — 2026-07-13

- Correctif : un compte laboratoire/réception rejeté ou suspendu par l'administration pouvait quand même se connecter normalement (contrairement aux autres rôles professionnels) — même vérification de statut appliquée désormais

## 2.9.1 — 2026-07-13

- Correctif : un échec après la création du compte lors d'une inscription médecin/pharmacien/infirmier(ère) pouvait verrouiller définitivement le candidat (compte orphelin nettoyé automatiquement, comme pour le patient)

## 2.9.0 — 2026-07-13

- Correctif : l'inscription d'un nouvel hôpital ne se synchronisait jamais côté serveur (règle manquante) — l'écran de validation admin ne voyait jamais les nouvelles inscriptions
- Correctif sécurité : le mot de passe de connexion hôpital était vérifié via un hash SHA-256 non salé, lisible par tout utilisateur connecté — remplacé par Firebase Authentication (comme pour le PIN patient), avec migration automatique des établissements existants

## 2.8.3 — 2026-07-12

- Correctif sécurité : un code d'accès refusé laissait le compte Firebase Auth du patient déjà créé (avec le PIN de celui qui l'avait saisi), verrouillant le vrai patient hors de son propre dossier — le compte orphelin est maintenant supprimé automatiquement

## 2.8.2 — 2026-07-12

- Nouveau : bouton 🔑 sur la liste des patients pour redonner le code d'accès si besoin (fenêtre limitée à 3 minutes)

## 2.8.1 — 2026-07-12

- Correctif sécurité : le premier accès patient pouvait, dans une fenêtre de quelques instants après la création de la fiche, contourner le code d'accès hôpital (course de synchronisation) — désormais refusé côté serveur tant que la fiche n'est pas confirmée

## 2.8.0 — 2026-07-12

- Préparation Firebase App Check (SDK intégré, inerte tant qu'aucune clé n'est configurée) : renforce la vérification que les requêtes viennent bien de l'app officielle

## 2.7.0 — 2026-07-11

- Suppression de compte self-service (Paramètres > Compte) : le patient ou le professionnel peut supprimer lui-même son accès, sans toucher au dossier médical

## 2.6.0 — 2026-07-11

- Code d'accès hôpital à usage unique pour le premier accès patient : ferme la préemption d'une fiche par un tiers connaissant seulement le numéro MC-xxx

## 2.5.0 — 2026-07-11

### Sécurité
- PIN patient migré vers Firebase Authentication (email synthétique +
  PIN comme mot de passe) — plus aucun PIN en clair écrit dans
  `mc_accounts` ; migration organique des comptes hérités à la
  connexion, sans jamais recopier l'ancien PIN.
- Isolation par établissement appliquée côté serveur (Firestore Rules,
  pas seulement côté interface) pour les fiches patient, consultations,
  ordonnances, laboratoire, admissions, accueil, urgences, maternité et
  journal d'audit — via une nouvelle collection `hospitalMembers`.
- Consentements patients (`mc_consents`) resserrés : seul le patient
  concerné peut approuver/refuser/révoquer ; le médecin demandeur ne
  peut jamais s'auto-approuver. Rappel : l'établissement créateur d'une
  fiche accède sans consentement — le consentement ne sert qu'aux accès
  externes.
- Ordonnances : le pharmacien ne peut plus modifier le contenu médical
  (diagnostic, médicaments, patient), uniquement le statut ; transitions
  de statut invalides refusées ; confirmation Firestore réelle avant
  d'afficher un message de succès.
- Scanner de secrets (`npm run security:scan`) et tests de règles
  Firestore avec émulateur (`npm run test:rules`) ajoutés à la CI.

## 2.4.0 — 2026-07-09

### Nouveautés
- Dossiers médicaux (DME) desktop hôpital : liste patients + dossier
  complet à onglets (résumé, historique, consultations, ordonnances,
  laboratoire, vaccinations, imagerie, documents, historique des accès).
- Système professionnel de gestion des versions et des mises à jour
  (PWA, Android, Desktop) : détection de nouvelle version, mise à jour
  du Service Worker sur confirmation, mode maintenance et version
  minimale obligatoire (administrateur uniquement), écran À propos.

### Corrections
- Inscription laboratoire/réception bloquée à tort par le registre
  infirmier (`ACL.isNurseVerified`) — ces deux rôles n'ont pas de
  registre officiel équivalent et sont désormais acceptés directement,
  en attente de validation administrateur.
- Nettoyage des mentions croisées avec d'autres projets (config
  d'hébergement, index de projets).

### Sécurité
- Isolation stricte des dossiers médicaux par établissement actif
  (`HospitalsRegistry.getCurrentHospital`), y compris pour le rôle
  administrateur dans cet écran.
- Visibilité des onglets du dossier médical strictement par rôle
  (réception : informations administratives seules ; laboratoire :
  analyses seules ; pharmacie : ordonnances seules).
