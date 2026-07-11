# Journal des versions — MedConnect

Ce fichier suit les nouveautés et corrections livrées à chaque version.
Affiché dans l'application via `VersionManager` (dialogue de mise à
jour) et l'écran **Paramètres → À propos**.

La source unique de la version en cours est `config/app-version.json` —
ce fichier doit rester cohérent avec elle.

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
