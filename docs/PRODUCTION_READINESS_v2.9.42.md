# MedConnect 2.0 — Préparation « prêt pour la production » (v2.9.42)

Ce document résume l'état de préparation de la version **2.9.42** pour un usage
réel avec de vraies données médicales, chantier par chantier, et énonce le
**verdict** honnête de mise en production.

- Version applicative : **2.9.42**
- Build : **2026.07.23.2** — Android versionCode **43** — cache SW **medconnect-v4.43**
- Base : branche `fix/v2.9.42-production-readiness` (depuis `main`, réf. `3bf895d`)
- Principe directeur : **additif, sans régression**. Firestore reste la seule
  source de vérité ; localStorage/IndexedDB ne sont que des caches. Aucun
  correctif ne se contente de masquer une erreur dans l'interface.

---

## Verdict

> **RELEASE BLOCKED** — la version n'est PAS déployable en production en l'état.

Deux étapes **serveur** restent à réaliser et à **valider en staging** avant
toute mise en production (voir `DEPLOYMENT_v2.9.42.md`) :

1. **Déployer les Cloud Functions** (`authLookup`, `claimPatientAccount`,
   `setVerifiedClientType`) puis **fermer la lecture publique de `mc_accounts`**
   dans `firestore.rules`. Tant que ce n'est pas fait, la lecture publique reste
   le repli du client (rien ne casse), mais la confidentialité de l'annuaire des
   comptes n'est pas encore fermée — donc **pas** « prêt production ».
2. **Activer l'enforcement App Check** et **promouvoir la CSP en mode bloquant**,
   après observation en staging (aucune violation).

Tant que ces points ne sont pas confirmés en staging, ne jamais écrire
« READY FOR PRODUCTION ». État actuel des sous-ensembles :

| Périmètre | État |
|---|---|
| Intégrité / synchronisation / historique / atomicité (côté client + règles) | ✅ Prêt (validé émulateur + suite JS) |
| Outbox multi-utilisateur, réconciliation ventes, recherche bornée, messagerie | ✅ Prêt |
| Migration de production (script) | ✅ Prêt (dry-run ; exécution manuelle par le propriétaire) |
| Cloud Functions (code) | ✅ Écrit et câblé ; ⏳ **déploiement + validation requis** |
| Fermeture lecture publique `mc_accounts` | ⏳ **gaté** (après déploiement des fonctions) |
| Enforcement App Check + CSP bloquante | ⏳ **gaté** (staging d'abord) |

**Sous-verdict staging : READY FOR STAGING.** La version peut être déployée en
**staging** pour valider les étapes serveur ci-dessus.

---

## Chantiers

### 1. Modèle canonique + synchronisation
Listeners cliniques **query-safe** par établissement (`establishmentId`) et filet
`created_by`, pour toutes les collections canoniques (`mc_consultations`,
`mc_prescriptions`, `mc_appointments`, `mc_lab_results`, `mc_admissions`,
`mc_emergency_cases`, `mc_maternity_cases`, `mc_vaccinations`) et `mc_patients`.
`mergeStore` fusionne sans jamais supprimer. Doubles écritures legacy retirées.
→ *tests : clinical-rehydration, canonical-collections, prescriptions-listener.*

### 2. Droits par rôle + confidentialité
Réception/labo lisent l'annuaire administratif (`patient_directory`), jamais la
fiche clinique complète. Lecture `mc_patients` réservée au personnel clinique de
l'établissement. → *tests : reception-lab-directory + règles clinical-isolation.*

### 3. Historique immuable
Consultations/analyses signées non modifiables (sauf admin) ; une ordonnance ne
peut voir muter ses champs cliniques ; une correction crée une nouvelle entrée
liée. → *tests : immutable-history (+ règles).*

### 4. Écritures atomiques + zéro faux succès
Création patient et vente en lot atomique ; `ActionFeedback.reportAtomic`
n'annonce « confirmé » que sur confirmation serveur, sinon « en file ».

### 5. Outbox multi-utilisateur sûre
`ownerAuthUid` capturé à la mise en file ; au flush, une opération d'un autre
auteur est **quarantainée** (jamais rejouée sous le mauvais compte, jamais
supprimée). Export de diagnostic **metadata-only**. → *tests : outbox-multiuser.*

### 6 & 7. Auth serveur + collections publiques + clientType
Cloud Functions `authLookup` / `claimPatientAccount` / `setVerifiedClientType`
(App Check exigé, config économe). Client en feature-detection avec repli.
`sourceDevice` n'est jamais une preuve de sécurité. → *tests : cloud-functions-wiring.*
**Étape gatée : fermeture de la lecture publique `mc_accounts`.**

### 8. Écritures de liste ciblées
`saveAccounts`/`saveUsers`/`saveRegistrationRequests`/`saveAffiliations` ne
poussent que les documents modifiés (diff par identifiant). → *tests : targeted-writes.*

### 9. Recherche patient + migration établissement
`searchPatients(q, establishmentIds?)` bornée ; `searchPatientDirectory` bornée à
`establishmentId`. `scripts/migrate-production-v2942.mjs` (dry-run par défaut,
strictement additif, journal, rollback). → *tests : patient-search-scoping, migrate-production.*

### 10. Pharmacie interne/externe + réconciliation vente hors ligne
`pharmacyType` immuable après validation (sauf admin plateforme). Vente hors
ligne réconciliée par transaction (décrément relatif du stock réel, refus +
quarantaine si insuffisant, idempotent). → *tests : pharmacy-offline-sale-reconcile.*

### 11. Messagerie fiable
Écriture ciblée unique, statut serveur, pas de faux « envoyé », contenu
confidentiel. → *tests : messaging-reliability.*

### 12. Sécurité production + coût
En-têtes de sécurité, export metadata-only, logs sans clinique, App Check activé.
Leviers de coût acquis (listeners bornés, arrêt doubles écritures, persistance,
`minInstances=0`). → *tests : production-security.*

### 13. Matrice comportementale
Cohérence de version (6 surfaces) + traçabilité règle→test. → *tests : production-readiness-matrix.*

### 14. Documentation + version
Ce document + `DEPLOYMENT_v2.9.42.md` + bump de version cohérent + miroirs
Android octet-pour-octet.

---

## Validation technique (à chaque chantier)

- Suite JS complète : **verte** (`node --test tests/*.test.js`).
- Lint : **0 erreur** (`npm run lint`).
- Scan de secrets : **propre** (`npm run security:scan`).
- Règles Firestore : émulateur (CI `tests.yml`, 35 fichiers de règles).
- Miroirs Android : identiques octet pour octet (`tests/apk-assets-sync.test.js`).
