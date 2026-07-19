# Firebase App Check — préparation (PWA + Android)

## Pourquoi App Check

Les Firestore Rules et Firebase Authentication vérifient **qui** fait une
requête (rôle, uid, établissement). Firebase App Check ajoute une couche
complémentaire qui vérifie **quelle application** fait la requête — il
rend beaucoup plus difficile pour un script tiers d'appeler directement
l'API Firestore avec la clé publique du projet (voir
`docs/FIREBASE_KEY_SECURITY.md`) en se faisant passer pour la PWA ou
l'app Android officielles.

**Mise à jour — les clés reCAPTCHA Enterprise pour la PWA sont
configurées.** `js/firebase-config.js` résout désormais la clé selon le
domaine réel (`APP_CHECK_SITE_KEYS`, voir `resolveAppCheckSiteKey()`) :
une seule clé fixe ne suffirait pas puisque la même PWA est chargée
depuis deux origines distinctes (GitHub Pages pour l'APK/Electron,
miroir Firebase Hosting), et reCAPTCHA Enterprise restreint chaque clé
à ses domaines déclarés. `activateAppCheck()` reste un no-op sûr sur
tout domaine non reconnu (développement local, tests). Le déploiement
reste volontairement progressif (mode monitoring d'abord, jamais
d'enforcement brutal qui risquerait de bloquer des utilisateurs
existants sans test préalable) — voir "Déploiement progressif"
ci-dessous, qui reste une action manuelle dans la Firebase Console,
indépendante de ce correctif de code.

⚠️ **Action manuelle restant à vérifier (hors de cet environnement)** :
confirmer dans la Firebase Console (projet `medconnect-e81ba` → App
Check → Apps → l'app Web) que la clé reCAPTCHA Enterprise y est bien
enregistrée comme fournisseur — la créer dans Google Cloud Console ne
suffit pas seule, Firebase App Check doit aussi la référencer pour que
les jetons émis soient acceptés côté serveur.

## Pour la PWA (Web) — FAIT

1. Firebase Console du projet `medconnect-e81ba` → App Check → app Web →
   fournisseur **reCAPTCHA Enterprise** (recommandé, remplace l'ancien
   reCAPTCHA v3 App Check désormais déprécié).
2. Deux clés reCAPTCHA Enterprise créées dans Google Cloud Console,
   chacune restreinte à l'un des domaines réels de l'app :
   - `davekbg08-cloud.github.io` (GitHub Pages, chargé par l'APK Android —
     voir `MainActivity.java` — ET l'app Electron desktop historiquement ;
     Electron charge désormais le miroir Firebase Hosting, voir
     `electron/main.js`)
   - `medconnect-e81ba.web.app` / `medconnect-e81ba.firebaseapp.com`
     (Firebase Hosting — chargé par Electron et tout accès navigateur direct)
3. **Côté code : fait.** `js/firebase-config.js` résout la clé par
   domaine (`APP_CHECK_SITE_KEYS`, `resolveAppCheckSiteKey()`) :
   ```js
   const APP_CHECK_SITE_KEYS = {
     'davekbg08-cloud.github.io': '<clé "GitHub">',
     'medconnect-e81ba.web.app': '<clé "Firestore"/Firebase Hosting>',
     'medconnect-e81ba.firebaseapp.com': '<même clé que .web.app>',
   };
   ```
   `activateAppCheck()` (même fichier) s'occupe du reste
   (`firebase.appCheck().activate(new ReCaptchaEnterpriseProvider(...), true)`)
   automatiquement au chargement de l'app, avec la clé correspondant au
   domaine courant — aucun autre changement de code nécessaire pour
   ajouter un futur domaine (il suffit d'ajouter une entrée à la map).
4. **Ne jamais** inclure de clé privée/secrète côté client — seules les
   clés reCAPTCHA publiques (site keys) vont dans le code, jamais une
   clé serveur. Ces clés sont des identifiants publics par construction
   (le mécanisme de sécurité reCAPTCHA ne repose pas sur leur secret).

## Pour Android

1. Dans la Firebase Console → App Check → ajouter l'app Android → fournisseur
   **Play Integrity** (remplace SafetyNet, déprécié).
2. Prérequis : l'app doit être signée avec le certificat de production
   (déjà le cas — voir `.github/workflows/build-medconnect-apk.yml`,
   keystore géré via GitHub Secrets) et son **empreinte SHA-256** doit
   être enregistrée dans la Firebase Console (Paramètres du projet →
   app Android → empreintes de certificat SHA).
   - Récupérer le SHA-256 du certificat de release :
     ```bash
     keytool -list -v -keystore android/keystore.jks -alias <KEYSTORE_ALIAS>
     ```
     (nécessite le keystore et son mot de passe — jamais commités,
     gérés uniquement via GitHub Secrets, voir `.gitignore`).
3. Play Integrity nécessite que l'app soit distribuée via Google Play
   (ou testée via Play Console en interne) pour une attestation complète
   — à date, l'APK MedConnect est distribué hors Play Store (voir
   architecture WebView documentée précédemment) ; Play Integrity reste
   utilisable mais avec des garanties d'attestation réduites hors Play
   Store. À réévaluer si une publication Play Store est envisagée.

## Déploiement progressif (obligatoire, jamais d'activation brutale)

1. **Mode monitoring** (Firebase Console → App Check → Enforce → laisser
   sur "Non appliqué"/Monitor) : les requêtes sans jeton App Check valide
   sont *loggées* mais jamais bloquées. Observer les métriques pendant au
   moins quelques jours pour confirmer que les vrais clients (PWA + APK +
   Electron) obtiennent bien un jeton valide, avant toute restriction.
2. **Enforcement** (Cloud Firestore → activer "Enforce") : seulement une
   fois le taux de requêtes sans jeton valide proche de zéro en mode
   monitoring. Activer service par service si possible.
3. Si l'app Electron desktop (voir `electron/`) doit aussi utiliser
   Firestore directement dans une future itération, elle nécessiterait
   son propre fournisseur App Check (reCAPTCHA, comme la PWA, puisqu'un
   `BrowserWindow` Electron est un contexte Web du point de vue de
   Firebase).

## Ce qui reste à faire (actions manuelles uniquement, plus de code)

- Vérifier dans la Firebase Console (App Check → Apps → app Web) que la
  clé reCAPTCHA Enterprise `medconnect-e81ba.web.app`/`.firebaseapp.com`
  y est bien enregistrée comme fournisseur (pas seulement créée côté
  Google Cloud) — sinon les jetons émis côté client sont rejetés côté
  serveur malgré une activation apparemment réussie côté PWA.
- Créer la clé reCAPTCHA Enterprise et l'app Android dans la Firebase
  Console pour Play Integrity (actions manuelles, nécessitent un accès
  administrateur au projet Firebase — non disponibles dans cet
  environnement) — non encore fait, Android reste sur ce point à "reste
  à faire" (voir section "Pour Android" ci-dessus).
- Documenter le SHA de production réel une fois extrait par le
  propriétaire du projet (le keystore n'est jamais accessible dans cet
  environnement de développement).
- Suivre la procédure "Déploiement progressif" ci-dessus (mode
  monitoring avant tout enforcement) avant de considérer App Check
  comme réellement actif en production.

## Déjà fait dans ce dépôt

- SDK `firebase-app-check-compat.js` (v9.22.0, même version que les
  autres SDK Firebase) chargé dans `index.html` et précaché dans
  `sw.js`.
- `js/firebase-config.js` : `APP_CHECK_SITE_KEYS` (une clé reCAPTCHA
  Enterprise par domaine réel de l'app) + `resolveAppCheckSiteKey()` +
  `activateAppCheck()`, appelée automatiquement par `initFirebase()`,
  no-op sûr sur tout domaine non reconnu.
- Avertissement non bloquant dans le tableau de bord admin
  (`js/admin.js`, `appCheckWarningBanner()`) si aucune clé n'est résolue
  pour le domaine courant — jamais présenté comme un remplacement des
  règles Firestore.
- Tests : `tests/firebase-app-check.test.js` — vérifie que
  l'initialisation Firebase reste inchangée sans clé résolue, que
  l'absence du SDK App Check ne plante jamais, et que l'activation
  appelle bien le bon fournisseur avec la bonne clé selon le domaine
  (`davekbg08-cloud.github.io`, `medconnect-e81ba.web.app`,
  `medconnect-e81ba.firebaseapp.com`, et un domaine inconnu resté inerte).
