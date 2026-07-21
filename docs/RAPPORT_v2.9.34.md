# Rapport de chantier — v2.9.34

**Branche :** `fix/2.9.34-workflows-sync-pharmacy-split`
**Base :** `main` (2.9.33)
**Contrainte fondatrice :** ne casser aucune logique existante ; l'historique
médical doit continuer d'exister et de contenir tous les documents. Tous les
correctifs sont **additifs** (lecture du code existant → bug confirmé →
correctif minimal → tests → synchronisation du miroir Android → suite JS +
règles Firestore + scan de secrets).

Format par point : **Bug → Cause → Correction → Limites**.

---

## P0 — Outbox : plus de rejeu automatique des écritures bloquées

- **Bug.** Une écriture définitivement refusée par le serveur (permission
  refusée, donnée invalide…) pouvait être rejouée automatiquement (après
  backoff, ou sur « forcer la synchro ») — répétant indéfiniment un échec
  certain.
- **Cause.** `flushOutbox()` ne distinguait pas, au rejeu, une erreur
  transitoire d'une erreur bloquante ; le forçage rejouait tout.
- **Correction.** Les entrées classées `blocked` (`classifyOutboxError`) ne
  sont **jamais** rejouées automatiquement, même avec `force` — uniquement par
  action manuelle (`retryOutboxOperation`/`retryBlockedOutbox`). Entrées
  enrichies (contexte d'opération, groupe atomique conservé comme une seule
  entrée). Inspecteur par opération dans l'écran Synchronisation : rejeu,
  suppression, export du diagnostic **sans aucune donnée sensible**
  (redaction).
- **Limites.** Sans Cloud Functions/Admin SDK, la classification repose sur le
  code d'erreur renvoyé par le SDK client ; une erreur inconnue est traitée
  prudemment comme transitoire (rejouable), jamais silencieusement supprimée.

## P0 — Création patient unifiée et strictement atomique

- **Bug.** Le parcours médecin (mobile et desktop) passait encore par
  `addPatientAndConfirm()` : cache local renseigné avant toute confirmation,
  trois écritures indépendantes (sans `patient_directory`, décomposables en
  outbox), code de premier accès affiché même quand rien n'avait atteint
  Firestore.
- **Cause.** Deux chemins de création coexistaient ; seul celui de la réception
  était atomique.
- **Correction.** Service unique `DB.addPatientAndConfirmAtomic()` partagé par
  tous les rôles : lot de 4 documents (`mc_patients` + `patients` +
  `medical_records` + `patient_directory`) **tout ou rien**, cache local et code
  d'accès **seulement après confirmation réelle**, réconciliation après timeout
  (relecture idempotente), mise en file du groupe atomique complet (une seule
  opération) hors ligne, verrou anti double-appel.
- **Limites.** `Promise.race` n'annule jamais une écriture Firestore déjà
  partie : l'idempotence repose sur des `set()` à identifiants fixes (rejouer le
  même groupe ne crée pas de doublon) et sur la relecture post-timeout.

## P0 — Messagerie : écritures ciblées, destinataire précis

- **Bug.** `DB.saveMessages()` réécrivait toute la boîte dans `mc_messages` **et**
  la recopiait dans `notifications` à chaque action (envoi, lecture,
  suppression) — N×2 écritures, doublons, mélange message/notification. Un
  formulaire mobile pouvait diffuser par rôle générique.
- **Cause.** Une seule primitive « tout réécrire » servait toutes les actions.
- **Correction.** Trois primitives ciblées : `saveMessagesLocal` (cache),
  `pushMessageAndConfirm` (un seul document), `updateMessageStatusAndConfirm`
  (champs de statut uniquement). Destinataire précis `toUid` canonique
  obligatoire. Règles : lecture/mise à jour réservées au destinataire réel,
  mise à jour limitée au statut + suppression logique, création exige un
  destinataire et un auteur cohérent ; `notifications.create` durci de même.
- **Limites.** Les champs historiques `to_id`/`recipientUid` restent acceptés en
  compatibilité ; la sécurité repose sur la cohérence d'auteur (l'expéditeur ne
  peut plus être usurpé), pas sur un chiffrement de bout en bout (hors périmètre
  sans backend).

## P0 — Session desktop sur `hospitalMembers` (source de vérité)

- **Bug.** La cohérence de session desktop se fondait en priorité sur un miroir
  staff local, modifiable par le propriétaire de l'établissement.
- **Cause.** `isSessionConsistent()` lisait le miroir avant la source serveur.
- **Correction.** `resolveAgentAffiliation` (`hospitalMembers`) est la source de
  vérité : `active` → cohérente ; `pending`/`rejected` (Firestore a répondu) →
  invalidation immédiate ; `none` (ambigu hors ligne) → repli sur le miroir
  local. Vérification supplémentaire compte suspendu / rôle changé
  (`users/{uid}`, repli local).
- **Limites.** Sans Admin SDK, il n'y a pas de révocation de session Firebase
  Auth ; l'accès aux **données** (Firestore) est refermé en quasi temps réel
  (`accountStatusOk`), ce qui n'est pas présenté comme une révocation de session.

## Pharmacie — split interne (desktop) / externe (mobile)

- **Bug / risque.** Le desktop proposait « pharmacie indépendante », et rien
  n'empêchait une pharmacie externe de s'affilier à un établissement ou de se
  requalifier.
- **Cause.** Aucun typage `pharmacyType` ; l'affiliation n'était pas conditionnée
  au type.
- **Correction.** Desktop = pharmacie **interne uniquement** (choix
  « indépendante » retiré, compte tagué `pharmacyType:'internal'` +
  `establishmentId`). `pharmacyType` **immuable** après création (sauf admin
  plateforme) sur `users`/`mc_accounts`/`pharmacies`. Affiliation
  (`affiliation_requests` + `hospitalMembers`) réservée aux pharmacies internes
  (`pharmacistAffiliationAllowed`), rétro-compatible (un compte sans
  `pharmacyType` reste autorisé ; seule la valeur `external` explicite bloque).
  Script `migrate-pharmacy-type.mjs` pour le backfill déterministe.
- **Limites.** La version **mobile** de la pharmacie (externe) n'a pas été
  touchée, conformément à la consigne. Tant que le backfill n'est pas appliqué,
  les comptes hérités non tagués restent traités comme internes (repli
  rétro-compatible assumé).

## Recherche patient via `patient_directory` (réception/labo)

- **Bug.** Réception et laboratoire ne pouvaient résoudre qu'un numéro MC exact
  (lecture d'un seul document) — impossible de chercher par nom/téléphone.
- **Cause.** Aucune requête sur l'annuaire non clinique.
- **Correction.** `DB.searchPatientDirectory(q, establishmentId)` interroge
  `patient_directory` **borné à `establishmentId`** (seule forme autorisée par
  les règles ; filtrage nom/téléphone côté client), ne renvoie **aucun contenu
  clinique**, replie sur le cache local hors ligne / permission refusée. Câblé
  dans la réception (`lookupPatient`) et le laboratoire (`_searchPatient`) avec
  liste de résultats cliquable.
- **Limites.** Firestore n'a pas de recherche plein texte : le filtre est
  client-side sur les entrées de l'établissement (volume raisonnable par
  hôpital), sans index composite.

## Pharmacie — ventes/stock atomiques, sans survente

- **Bug.** `addSale()` écrivait la vente puis décrémentait le stock par écritures
  indépendantes ; `Math.max(0, …)` **masquait** une survente (stock plancher à
  0, mais vente acceptée). `checkout()` imprimait le reçu et annonçait le succès
  même en cas d'échec cloud.
- **Cause.** Pas d'atomicité ni de validation de stock avant écriture.
- **Correction.** `DB.addSaleAtomic()` valide le stock d'abord (refus total si
  survente, quantité ≤ 0, ou médicament inconnu — jamais de stock négatif),
  écrit vente + décréments dans un lot atomique, cache local après confirmation,
  contrat de retour enrichi. `checkout()` asynchrone, anti double-clic, reçu et
  succès seulement après confirmation. Règles : `pharmacyUid` immuable sur
  `mc_medicines`/`mc_sales`.
- **Limites.** La validation de stock est faite côté client sur le cache local ;
  en cas de concurrence réelle multi-postes, la source de vérité reste le lot
  atomique (une confirmation gagne, l'autre échoue proprement).

## ActionFeedback étendu — `reportAtomic`

- **Bug.** Le motif d'interprétation du contrat atomique enrichi
  (confirmé/en file/refusé/occupé/stock insuffisant) était réimplémenté à
  l'identique dans chaque action critique, avec des variations involontaires.
- **Correction.** `ActionFeedback.reportAtomic(result, opts)` centralise
  l'annonce et renvoie un état normalisé, sans décider de la suite métier.
  Utilisé par `pharmacy.js checkout` et `hospital.js saveNewPatient`.
- **Limites.** N'impose rien à l'appelant : la logique de suite (modale,
  navigation, code d'accès) reste locale, par conception.

## Audit `firestore.rules` — notifications, statuts, immuabilité

- **Bug.** `notifications` partageait `read`/`update` dans la même clause : le
  destinataire pouvait réécrire le contenu (titre/message) et réattribuer
  l'expéditeur, pas seulement marquer lu.
- **Correction.** Lecture / mise à jour séparées ; mise à jour restreinte aux
  champs de statut (`notificationStatusFieldsOk`). Rappel des immuabilités
  vérifiées sans régression : `role`/`status`/`uid`/`authUid`/`pharmacyType`/…
  figés (users, mc_accounts, doctors/nurses/pharmacies) ; `pharmacyUid` figé
  (medicines/sales) ; statuts de message limités.
- **Limites.** Aucun flux client ne réécrivait le contenu d'une notification :
  durcissement purement additif.

---

## Validation technique

- **Suite JS :** 750 tests, 0 échec (`npm test`).
- **Règles Firestore (émulateur) :** suite complète exécutée, 0 échec réel
  (des faux départs de warmup d'émulateur, connus, sont réessayés
  automatiquement ; chaque fichier concerné a été confirmé vert en exécution
  isolée : pharmacie split 10/10, isolation pharmacie 15/15, messagerie +
  notifications 19/19).
- **Scan de secrets :** aucun secret détecté (`npm run security:scan`).
- **Miroirs Android :** tous les fichiers `js/` modifiés synchronisés
  octet pour octet dans `android/app/src/main/assets/js/`.
- **Version :** 2.9.34 propagée (app-version.json, package.json,
  electron/package.json, build.gradle versionCode 35, MainActivity `?apk=`,
  sw.js cache v4.35, CHANGELOG).
- **Pas de build AAB** (hors périmètre, conformément à la consigne).

## Périmètre volontairement exclu

- Flux **mobile** de la pharmacie externe (existant, non touché).
- Tout ce qui nécessiterait un backend (Cloud Functions / Admin SDK) : la
  révocation de session Auth et le chiffrement de bout en bout restent hors de
  portée sur le plan Spark ; les correctifs referment l'accès aux **données**.
