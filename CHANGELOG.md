# Journal des versions — MedConnect

Ce fichier suit les nouveautés et corrections livrées à chaque version.
Affiché dans l'application via `VersionManager` (dialogue de mise à
jour) et l'écran **Paramètres → À propos**.

La source unique de la version en cours est `config/app-version.json` —
ce fichier doit rester cohérent avec elle.

## 2.9.41 — 2026-07-23

Correctif majeur — les fiches patient qui « disparaissaient ». Chantier de récupération cloud des fiches, additif, sans régression (isolation par établissement vérifiée à l'émulateur).

**Cause racine (confirmée à l'émulateur).** Le seul chemin de lecture cloud des patients était un listener sur la collection `mc_patients` **entière**, que les règles par-document rejettent en bloc pour tout rôle clinique — jamais pour l'admin (dont la condition est constante). Le cache local n'était donc **jamais rechargé** depuis Firestore ; après la purge du cache médical à la déconnexion (`js/auth.js`), la liste des patients restait vide alors que les fiches étaient bien enregistrées dans le cloud. Côté patient, la fiche ne porte aucun champ le liant (ni `uid`, ni `patientAuthUid`) : après déconnexion, il ne pouvait plus relire ses données ni se connecter depuis son propre téléphone (« Numéro de fiche introuvable »).

- **`js/db.js` — rechargement par requêtes filtrées.** `setupUserScopedListeners` monte désormais, pour les rôles membres (`doctor`, `nurse`, `reception`, `lab`, `admin_hospital`), des listeners `mc_patients` **filtrés** : `where('establishmentId','==', <chaque établissement du membre>)` **et** `where('created_by','==', uid)` — seules formes acceptées par les règles (mesuré à l'émulateur : la requête établissement passe, la collection entière et l'autre-établissement restent refusées). Le listener global est **conservé** pour l'admin (accepté) et documenté. La liste patients se recharge donc après chaque connexion et changement d'établissement.
- **`js/auth.js` — outbox préservée à la déconnexion.** `mc_cloud_outbox` n'est plus purgé avec les caches médicaux : une fiche créée hors ligne, encore en file, n'est plus détruite au logout — elle n'est retirée que lorsque l'outbox est **vide** (tout confirmé).
- **`js/auth.js` — connexion patient sans dépendance au cache local.** `_doPatient` et `_createPatientPin` authentifient d'abord via le compte (`mc_accounts`, lecture publique) + le PIN (Firebase Auth), sans exiger la fiche en cache local ; la validité du numéro et du code d'accès reste vérifiée côté serveur. La fiche est **relue en tant que propriétaire** après authentification (`_hydratePatientRecordAfterAuth`) pour repeupler le cache.
- **`firestore.rules` — branche additive « patient propriétaire ».** Un patient authentifié titulaire du compte `mc_accounts/PAT_{id}` (authUid correspondant) peut lire **sa propre** fiche `mc_patients/{id}`. Ajout en OR — n'élargit rien pour le personnel, isolation inchangée. Validé à l'émulateur (propriétaire accepté ; autre patient, compte absent et usurpation refusés ; non-régression des requêtes médecin et de l'isolation inter-établissements).

Tests : `tests/patient-cloud-recovery-v2941.test.js` (10 points) + `tests/firestore-rules/patient-own-fiche-read.rules.test.js` (règles, dont non-régression). Version **2.9.41** (build 2026.07.23.1, versionCode 42, cache `medconnect-v4.42`). Miroirs Android resynchronisés octet pour octet. **Déploiement : règles Firestore + Hosting.**

## 2.9.40 — 2026-07-22

Chantier E — Reporting d'établissement. Nouvelle fonctionnalité additive, 100 % côté client, aucune nouvelle collection Firestore, aucun serveur.

- **Page « Reporting »** (`js/hospital-reporting.js`, nouveau) sur le poste hôpital, **réservée à l'administration** (`admin` / `admin_hospital` — jamais aux rôles cliniques ou d'accueil ; garde revérifiée au rendu). Vue d'ensemble chiffrée de l'activité de l'établissement : **taux d'occupation des lits**, lits occupés/libres/maintenance, **patients hospitalisés**, files d'attente et **pré-admissions**, **urgences en cours**, **analyses de laboratoire** (en attente/terminées), **consultations du jour**, arrivées du jour.
- Calculé **localement** à partir des données déjà lues (`CloudDB.listByHospital` — beds, admissions, labRequests, mc_consultations, emergencyCases), avec dégradation propre à 0 si une collection est absente.
- **Export CSV** (téléchargement local, séparateur `;` + BOM UTF-8) et **impression / PDF** (fenêtre navigateur). N'expose que des **agrégats** — aucune donnée patient nominative. Les pharmacies (isolées) ne sont pas incluses.
- Câblage : route `reporting` (`HospitalPermissions`), entrée de menu, renderer natif desktop, précache service worker.

## 2.9.39 — 2026-07-22

Chantier B — performance : chargement à la demande. Additif, aucune rupture, mode hors ligne préservé.

- **Leaflet différé** (`js/lazy-loader.js` *(nouveau)*, `index.html`, `js/map.js`, `sw.js`). La bibliothèque de cartes (~150 Ko de JS + son CSS) n'est plus chargée au démarrage de l'application : elle l'est **à la première ouverture d'une carte**, via un petit chargeur `LazyLoader` (idempotent, cache de promesses, aucune conversion en modules ES). Les écrans sans carte se chargent donc plus vite (surtout mobile / réseau lent). Le **service worker précache toujours Leaflet** → la carte reste disponible hors ligne. Message honnête si la carte ne peut pas être chargée (tout premier accès hors ligne).
- **Infrastructure réutilisable.** `LazyLoader.load(src, globalName)` / `loadCss(href)` servira aux prochains différés (modules desktop, IA…) dans un chantier ultérieur, avec la même prudence.

## 2.9.38 — 2026-07-22

Chantier A — socle UI/UX + accessibilité + sécurité. Additif, rétrocompatible, aucune rupture de logique ni de règles Firestore.

- **Toasts accessibles & priorisés** (`js/app.js`, `css/style.css`). `App.toast(msg, type)` reste identique côté appelants ; ajout d'un 3ᵉ argument `opts` facultatif. Annonce lecteur d'écran (`aria-live` assertive pour erreur/urgence, polite sinon), icône par type, durée selon la gravité (erreur plus longue, `urgence` persistante jusqu'à fermeture), empilement borné (max 4), action rapide optionnelle (ex. « Accepter » un transfert) et bouton de fermeture. Message toujours posé via `textContent` (aucune injection).
- **Boutons — accessibilité & états** (`css/style.css`, `js/app.js`, `js/hospital.js`). `.btn` : cible tactile ≥ 44px, `:focus-visible`, `:disabled`, `.btn-loading` (spinner, respect de `prefers-reduced-motion`), variantes de rôle `.btn-danger`/`.btn-medical`/`.btn-admin` réutilisant les couleurs existantes. Helper `App.setBtnLoading(btn, bool)` (spinner + `aria-busy` + désactivation) compatible avec `button-feedback.js`. `aria-label`/`title` sur les boutons en icône seule (🩺 consultation, 🖨️ impression).
- **Thème automatique** (`js/app.js`). À défaut de choix explicite (`mc_theme`), l'app suit `prefers-color-scheme` ; le choix manuel reste prioritaire. Sombre demeure le défaut.
- **`sourceDevice` — contrat de sécurité explicite** (`js/exchange-bridge.js`). Documentation du fait que ce champ, dérivé du client, ne sert qu'à l'aiguillage d'UI et, dans les règles, qu'à *assouplir* la garde d'abonnement pour le mobile (continuité des soins) — jamais à accorder un accès ni comme garde unique. Comportement des règles **inchangé** ; un test verrouille la forme sûre de `hospitalCanWriteFromDevice` et la présence de la limite connue documentée.

## 2.9.37 — 2026-07-22

Retours utilisateur sur le poste hôpital (desktop). Correctifs additifs, aucune nouvelle collection, aucune modification de la logique Pharmacie/Réception ni des règles Firestore.

- **Médecin — créer une ordonnance.** Les pages « Consultations » et « Ordonnances » (des historiques en lecture seule) affichent désormais un bouton **« + Nouvelle Consultation »**. On choisit le patient, la consultation s'ouvre, et l'ordonnance s'y rédige comme d'habitude. Le médecin ne restait plus sans point d'entrée. Gardé par la capacité `create_consultation` (médecin/admin).
- **Infirmier(ère) — créer une fiche.** Le bouton **« + Nouveau patient »** est de nouveau visible : la capacité `create_patient`, absente par erreur de la matrice desktop, est rendue à l'infirmière. Elle crée la fiche d'accueil (statut « À compléter par le médecin » jusqu'à la 1ʳᵉ consultation, cf. 2.9.36). Aucun droit médical supplémentaire (ni prescription, ni transfert, ni consultation).
- **Infirmier(ère) — plus de « Réception / Accueil ».** Cette section n'apparaît plus dans le menu de l'infirmière : l'accueil et l'enregistrement des arrivées restent au rôle Réception et à l'administration. L'infirmière conserve Tableau de bord, Patients, Dossiers, Lits, Laboratoire, Ordonnances (lecture), Urgences, Maternité et Messagerie.
- **Pharmacie — message d'affiliation au réseau lent.** Un dépassement de délai à la confirmation de l'affiliation n'est plus présenté comme une erreur rouge. Le compte est bien créé et la demande, enregistrée localement, est transmise automatiquement au retour de la connexion puis approuvée par l'administration. Les vrais échecs (établissement introuvable, permission refusée) restent signalés en rouge.

## 2.9.36 — 2026-07-21

Correctif ciblé : complétion médicale d'une fiche patient créée par une infirmière. Aucune nouvelle fonctionnalité, aucune nouvelle collection ; Pharmacie et Réception inchangées.

### Correctif
- **Complétion d'une fiche créée par une infirmière** : bug confirmé — quand un médecin réalisait la première consultation, l'ancien code appelait `DB.updatePatient()`, qui modifiait le cache local immédiatement (affichant « fiche complétée ») **puis** tentait de réécrire toute la fiche dans Firestore, alors que les règles interdisent au médecin de modifier `mc_patients`. Résultat : le médecin voyait « complétée » mais le serveur refusait l'écriture, les autres appareils affichaient encore « À compléter par le médecin », et des écritures `permission-denied` pouvaient s'accumuler dans la file de synchronisation. Corrigé par :
  - une **fonction dédiée** `DB.completeNurseCreatedPatientAfterConsultation` qui effectue **uniquement** la transition `awaiting_doctor`/`pending` → `active`/`completed` par une **écriture partielle** (merge) confinée à `mc_patients`/`patients`, **après confirmation Firestore de la consultation**, et ne renseigne le cache local qu'après confirmation réelle — jamais de faux succès ;
  - un **helper de règles** `doctorCanCompleteNurseCreatedPatient` : la seule exception au verrou `update` de `mc_patients`, strictement limitée aux champs de complétion, exigeant une consultation **réelle vérifiée** (existence, même patient, même établissement, appartenant au médecin) et une affiliation active — l'identité du patient, la traçabilité de l'infirmière (`created_by`/`nurse_uid`/`nurse_name`) et l'historique sont préservés ;
  - une opération de complétion dédiée dans la file de synchronisation (`patient_medical_completion`) rejouée en écriture **partielle** ; un refus serveur est classé « bloqué » (jamais rejoué automatiquement).

## 2.9.35 — 2026-07-21

Audit post-déploiement (intégrité des stocks, confidentialité, isolation, fiabilité, sécurité Android). Deux vrais problèmes corrigés ; les autres axes se sont révélés conformes ou relèvent de limites structurelles documentées (lecture publique de `mc_accounts` nécessaire au login pré-authentification, sans backend).

### Intégrité des données
- **Ventes pharmacie sans survente concurrente** : bug confirmé — `addSaleAtomic` (v2.9.34) validait le stock à partir du cache **local** puis écrivait un lot `set` qui **écrase** le stock. Deux ventes simultanées sur deux postes lisaient toutes deux « stock = 10 », vendaient 8 chacune et écrivaient « stock = 2 » : 16 unités vendues pour 10 en stock, sans erreur. La vente en ligne passe désormais par une **transaction Firestore** (`runTransaction`) qui **relit le stock réel** au moment de l'écriture et refuse la vente entière si un article n'a plus assez de stock — jamais de survente ni de stock négatif (même mécanisme que l'attribution de lit). Limite documentée : la garantie stricte ne vaut que pour les ventes réalisées **en ligne** ; hors ligne, le lot optimiste est mis en file et rejoué à la reconnexion.

### Sécurité
- **Android — liens externes hors WebView** : `shouldOverrideUrlLoading` chargeait toute URL hors domaine officiel **dans le WebView de l'application** (celui qui expose le pont natif `AndroidUpdater`). Un lien externe (reçu dans un message, page d'aide, tentative de hameçonnage) s'ouvrait ainsi « à l'intérieur » de l'app, héritant de son contexte. Les destinations hors domaine officiel sont désormais ouvertes dans le **navigateur/application système** (Intent `ACTION_VIEW`), y compris les schémas `tel:`/`mailto:`. Le téléchargement d'APK restait déjà verrouillé à un préfixe de confiance (`TRUSTED_APK_URL_PREFIX`).

## 2.9.34 — 2026-07-21

### Sécurité
- Pharmacie interne/externe : sur le desktop hôpital, une pharmacie est désormais **toujours** un service interne de l'établissement (le choix « indépendante » a été retiré du desktop) ; la pharmacie indépendante (externe) reste exclusivement mobile. Le champ `pharmacyType` (`internal`/`external`) est **immuable** après création (seul l'admin plateforme peut le corriger), et l'affiliation à un établissement (`affiliation_requests` + `hospitalMembers`) est réservée aux pharmacies internes (`pharmacistAffiliationAllowed`).
- Session desktop : `isSessionConsistent()` s'appuie en priorité sur l'affiliation réelle (`hospitalMembers` via `resolveAgentAffiliation`) — un membre retiré/en attente/rejeté, un compte suspendu ou un rôle changé invalident la session sans attendre ; le miroir staff local n'est plus qu'un repli hors ligne.
- Messagerie : destinataire précis (`toUid` canonique) obligatoire à la création (plus de diffusion générique par rôle depuis un formulaire mobile) ; lecture/mise à jour réservées au destinataire réel, mise à jour restreinte aux champs de statut et à la suppression logique.
- Notifications : le destinataire ne peut plus réécrire le contenu (titre/message/type) ni réattribuer l'expéditeur — seulement marquer lue/vue (champs de statut) ; cohérence d'auteur et présence d'un destinataire exigées à la création.
- Ventes/stock pharmacie : `pharmacyUid` immuable sur `mc_medicines`/`mc_sales` (un pharmacien ne peut jamais réattribuer un stock ou une vente à un autre compte ; seul un document hérité sans `pharmacyUid` peut être réclamé par son propriétaire réel).

### Fiabilité
- Outbox : une écriture définitivement refusée par le serveur (permission refusée, donnée invalide…) n'est plus jamais rejouée automatiquement — elle attend une nouvelle tentative manuelle. Écran Synchronisation doté d'un inspecteur détaillé par opération (rejeu, suppression, export du diagnostic sans aucune donnée sensible).
- Création patient : service unique strictement atomique pour tous les rôles (médecin mobile/desktop, réception) — les quatre documents (dont l'annuaire et le dossier médical racine) sont créés ensemble ou pas du tout ; le code de premier accès n'est affiché qu'après confirmation réelle ; une coupure réseau met la création complète en file (une seule opération atomique, rejouée sans doublon).
- Vente en pharmacie : atomique et sans survente (jamais de stock négatif) — la vente et la mise à jour du stock aboutissent ensemble ou pas du tout ; aucun reçu ni succès affiché tant que le serveur n'a pas confirmé ; message clair sur stock insuffisant, hors ligne, ou refus serveur.
- `ActionFeedback.reportAtomic()` : interprétation centralisée du contrat de résultat atomique enrichi (confirmé/en file/refusé/occupé/stock insuffisant), réutilisée par la création patient et la vente pharmacie.

### Améliorations
- Recherche patient (réception et laboratoire) : par nom ou téléphone via l'annuaire non clinique (`patient_directory`), borné à l'établissement — plus seulement par numéro MC exact.

### Migration
- `scripts/migrate-pharmacy-type.mjs` : backfill déterministe du champ `pharmacyType` sur les comptes pharmacien hérités (interne si rattachement à un établissement avéré, externe sinon ; dry-run par défaut, `--apply` pour écrire).

## 2.9.33 — 2026-07-20

### Sécurité
- Transfert médical d'urgence (emergencyTransfers) : un membre du personnel sans le droit de décider un transfert (infirmier(ère), réception, laborantin, pharmacien) pouvait, par une écriture Firestore directe, créer un vrai transfert en son nom — le helper serveur `canDecideTransfer()` existait déjà mais n'était jamais câblé sur la règle ; corrigé, et le bouton/l'action côté client (js/hospital.js) le vérifient désormais aussi.
- Premier accès patient : dernière fenêtre de contournement du code d'accès sur une fiche héritée fermée.
- Transferts médicaux et partages de dossier : contrôle des transitions de statut et de l'appartenance des parties renforcé.
- Messagerie : un message professionnel pouvait être créé sans identité d'expéditeur vérifiable — désormais toujours refusé.
- Lecture par rôle : réception et laboratoire pouvaient lire des informations hors de leur rôle réel sur plusieurs écrans (admissions, urgences, lits, journaux d'audit) — restreint.
- Affiliation d'un agent à son établissement : revérifiée en priorité côté serveur (hospitalMembers/demandes d'affiliation) plutôt que depuis un cache local modifiable par le propriétaire de l'établissement, sans perdre la résilience hors ligne.
- Premiers en-têtes de sécurité navigateur (Firebase Hosting) : X-Frame-Options, Strict-Transport-Security, Permissions-Policy, et une CSP en mode observation (Report-Only, jamais bloquante à ce stade).

### Corrections
- Formulaires desktop (nouveau dossier de grossesse, arrivée urgente, réception) : un(e) infirmier(ère) pouvait saisir entièrement l'identité d'un nouveau patient avant d'être refusé(e) seulement à l'enregistrement — les champs concernés ne sont désormais proposés qu'aux rôles qui peuvent réellement créer un patient.
- Gestion des lits : boutons "+ Lit"/mise en maintenance restaient visibles pour un rôle sans ce droit (médecin) — corrigé.
- Bouton de transfert patient (liste "Patients") : pouvait rester invisible à tort après une reconnexion (mauvaise source du rôle courant) — corrigé.
- Attribution d'un lit : deux confirmations simultanées pouvaient réserver le même lit à deux patients — passe désormais par une transaction Firestore atomique.
- Création de fiche patient par la réception : rendue réellement atomique (plus d'écritures indépendantes avant le batch).
- Messagerie : "envoyé" s'affichait avant confirmation cloud réelle ; statut lu/non lu peu fiable entre appareils ; aucun badge de non-lus côté desktop — corrigés, avec un contrat commun confirmé/en attente et un nouveau badge desktop.

### Nouveautés
- Annuaire non clinique des patients (`patient_directory`), pour réduire ce que réception/laboratoire consultent pour identifier un patient.
- Inscription et affiliation pharmacie directement depuis le desktop hôpital (rattachée à un établissement ou indépendante).
- Statistiques des lits (libres/occupés/maintenance, taux d'occupation) sur la page Réception.
- Écran "🔄 Synchronisation" (Paramètres, mobile et desktop) : classification automatique de chaque écriture en attente (transitoire vs bloquante), avec vérification manuelle immédiate.
- Helper `ActionFeedback` commun (verrou anti-double-clic + retour confirmé/en attente/échec), appliqué à la messagerie mobile et desktop.

### Autres
- Adresse courriel affichée corrigée (faute de frappe) ; mention non vérifiée "195 pays" retirée de la page d'accueil.
- Script d'audit des enregistrements pharmacie historiques sans propriétaire identifié (`scripts/audit-legacy-pharmacy-records.mjs`).

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
