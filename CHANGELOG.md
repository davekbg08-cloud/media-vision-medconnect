# Journal des versions — MedConnect

Ce fichier suit les nouveautés et corrections livrées à chaque version.
Affiché dans l'application via `VersionManager` (dialogue de mise à
jour) et l'écran **Paramètres → À propos**.

La source unique de la version en cours est `config/app-version.json` —
ce fichier doit rester cohérent avec elle.

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
