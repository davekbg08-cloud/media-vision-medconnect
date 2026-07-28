# MedConnect 2.0 — Guide de déploiement v2.9.42

⚠️ **Aucun déploiement n'est effectué automatiquement.** Ce guide décrit les
étapes manuelles, dans l'ORDRE impératif, à réaliser par le propriétaire du
projet. La version est **RELEASE BLOCKED** tant que les étapes serveur (§3–§5)
ne sont pas faites ET validées en staging.

Rappel des invariants de sécurité de cette version :
- Ne **jamais** supprimer de données Firestore, ne réinitialiser aucune
  collection, ne remplacer aucune migration par delete/recreate.
- Toute migration : **sauvegarde → dry-run → journal → rollback** possible.

---

## 0. Pré-requis

```bash
npm ci                     # dépendances de test/lint
npm run lint               # 0 erreur attendue
node --test tests/*.test.js  # suite verte
npm run security:scan      # aucun secret
```

Le service-account Firebase **ne doit jamais** être collé dans un dépôt, un
ticket ou un chat — il reste sur le poste de l'exploitant, référencé via
`GOOGLE_APPLICATION_CREDENTIALS`.

---

## 1. Sauvegarde Firestore (obligatoire avant toute migration)

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
node scripts/backup-firestore.mjs
```

## 2. Migration de cohérence (dry-run PUIS apply)

```bash
node scripts/migrate-production-v2942.mjs                       # dry-run (rien écrit)
# vérifier le journal migration-journal-v2942-*.json, puis :
node scripts/migrate-production-v2942.mjs --apply --i-have-a-backup
```
Le script est strictement additif (recopie de champ manquant, création
d'entrées `patient_directory` manquantes) ; conflits/ambiguïtés signalés pour
traitement manuel. `--limit`, `--resume-from`, `--collection` disponibles.

---

## 3. Déployer les Cloud Functions (chantiers 6/7) — AVANT toute règle

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```
Vérifier ensuite, sur un compte de test :
- connexion d'un professionnel (résolue via `authLookup`) ;
- premier accès patient (liaison via `claimPatientAccount`).

> Région par défaut : `europe-west1` (surchargeable via
> `MEDCONNECT_FUNCTIONS_REGION`). Le client (`js/firebase-config.js`) initialise
> `firebase.functions('europe-west1')` — garder les deux cohérents.

## 4. Fermer la lecture publique de `mc_accounts` — SEULEMENT après §3 ET §6 validés

> ⚠️ **Prérequis d'ORDRE** : déployer d'abord les Cloud Functions (§3) **puis le
> Hosting v2.9.42 (§6)**, et seulement ENSUITE fermer `mc_accounts`. C'est le
> Hosting qui met en ligne le client v2.9.42 : il active App Check (les
> fonctions ont `enforceAppCheck:true`) et fait passer la résolution de compte
> par les fonctions. Fermer la règle alors que l'ancien client (lecture directe)
> est encore servi casserait la connexion. Le script `deploy-ordered-v2942.sh`
> applique déjà le bon ordre (fonctions → hosting → règles).

La règle restreinte est **déjà présente** dans `firestore.rules` (bloc
`match /mc_accounts/{docId}` : lecture réservée au titulaire — `docId` ou
`authUid` == `request.auth.uid` — ou à l'admin). Plus aucune édition manuelle
n'est nécessaire ; il suffit de déployer. Les `get()` internes des règles sur
`mc_accounts` continuent de fonctionner (ils ignorent la règle `read`), et la
détection de doublon à l'inscription passe désormais par la fonction
`checkAgentDuplicate` (déployée au §3).

```bash
firebase deploy --only firestore:rules
```
Contrôle immédiat : reconnexion professionnelle et premier accès patient
fonctionnent toujours (désormais via les fonctions). En cas de problème :
rollback rapide des règles depuis l'onglet **Règles** de la console Firebase
(version précédente) le temps de diagnostiquer.

> 💡 **Raccourci ordonné.** Le script `scripts/deploy-ordered-v2942.sh`
> enchaîne §3 → §4 → §6 avec des *gates* de confirmation manuelle entre chaque
> étape : il **refuse de déployer les règles** tant que tu n'as pas confirmé
> que le login staging fonctionne après le déploiement des fonctions. Lance
> `scripts/deploy-ordered-v2942.sh --dry-run` pour prévisualiser sans rien
> déployer, puis sans `--dry-run` pour exécuter.

## 5. Sécurité : App Check + CSP (staging d'abord)

- **App Check** : activer l'enforcement dans la console Firebase seulement après
  avoir vérifié qu'aucun appareil légitime n'est rejeté (voir
  `docs/FIREBASE_APP_CHECK_SETUP.md`).
- **CSP** : la politique est désormais **bloquante** (`Content-Security-Policy`,
  header dans `firebase.json`) et **complète** — audit de toutes les ressources
  réellement chargées (Firebase SDK, reCAPTCHA/App Check, Leaflet, Google Fonts,
  QR codes, Claude API, EuropePMC, Overpass). Elle prend effet au déploiement
  Hosting (§6). Contrat verrouillé par `tests/csp-hosting-headers-v2942.test.js`.

  - **Compromis assumé** : `script-src` conserve `'unsafe-inline'`. L'app repose
    sur un `<script>` inline (index.html) et ~276 gestionnaires `onclick=`
    inline ; les bloquer casserait toute l'UI. Le durcissement porte donc sur la
    **restriction des hôtes** (scripts/connect/frame/img/style/font limités aux
    domaines légitimes) + `object-src 'none'`, `base-uri 'self'`,
    `form-action 'self'`, `frame-ancestors 'none'`, `worker-src 'self'`,
    `manifest-src 'self'`. Suivi ouvert : migrer vers la délégation d'événements
    pour retirer `'unsafe-inline'` et obtenir une vraie protection anti-XSS
    inline.
  - **Rollback immédiat** si une ressource légitime est bloquée en prod :
    remettre la clé du header à `Content-Security-Policy-Report-Only` dans
    `firebase.json` puis `firebase deploy --only hosting` (la politique
    redevient observation seule, l'app n'est plus contrainte). Diagnostiquer via
    la console navigateur (les violations y sont journalisées).
  - **Vérif post-déploiement** (console navigateur, onglet Console) : connexion,
    carte (tuiles + POI), recherche de littérature médicale, synthèse IA,
    impression d'ordonnance (QR) — aucune erreur `Refused to … because it
    violates the following Content Security Policy directive`.

  > ⚠️ **Suivi sécurité (hors périmètre CSP)** : `js/medical-ai.js` appelle
  > `https://api.anthropic.com` **directement depuis le navigateur**. La CSP
  > autorise cet hôte pour ne pas casser la fonctionnalité, mais un appel direct
  > expose la clé API côté client. Recommandation : proxifier via une Cloud
  > Function (la clé restant dans Secret Manager). À traiter dans un chantier
  > dédié — ne pas bloquer la CSP là-dessus.

---

## 6. Hosting (PWA) + version

```bash
firebase deploy --only hosting
```
Le SW passe au cache `medconnect-v4.43` ; `VersionManager` propose la mise à
jour (jamais forcée pendant qu'un onglet travaille).

## 7. Android (APK)

`versionCode 43` / `versionName 2.9.42`. Les miroirs `android/app/src/main/assets`
sont déjà synchronisés octet pour octet (vérifié par
`tests/apk-assets-sync.test.js`). Construire et publier l'APK selon le processus
habituel ; `MainActivity` pointe la PWA en `?apk=v2.9.42`.

---

## Ordre récapitulatif

1. Sauvegarde → 2. Migration (dry-run puis apply) → 3. **Cloud Functions**
(`enforceAppCheck`) → **6. Hosting v2.9.42** (met en ligne le client qui active
App Check + passe par les fonctions) → **4. Fermeture `mc_accounts`** (sûre une
fois le nouveau client servi) → 5. **App Check enforce** (seulement quand le %
vérifié ≈ 100 %) → 7. Android.

> Le Hosting (§6) doit précéder la fermeture de `mc_accounts` (§4) : c'est lui
> qui met en ligne le client v2.9.42 (App Check + résolution via fonctions). Le
> script `scripts/deploy-ordered-v2942.sh` applique cet ordre
> (**fonctions → hosting → règles**) avec des gates de validation manuelle.

Ne passer en production qu'une fois §3–§5 **validés en staging**. Sinon, la
version reste **RELEASE BLOCKED**.
