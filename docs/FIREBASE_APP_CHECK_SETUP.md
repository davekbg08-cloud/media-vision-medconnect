# Firebase App Check — préparation (PWA + Android)

## Pourquoi App Check

Les Firestore Rules et Firebase Authentication vérifient **qui** fait une
requête (rôle, uid, établissement). Firebase App Check ajoute une couche
complémentaire qui vérifie **quelle application** fait la requête — il
rend beaucoup plus difficile pour un script tiers d'appeler directement
l'API Firestore avec la clé publique du projet (voir
`docs/FIREBASE_KEY_SECURITY.md`) en se faisant passer pour la PWA ou
l'app Android officielles.

**Mise à jour — l'intégration côté code est maintenant faite** (SDK
chargé, activation prête). Elle reste **inerte pour tous les
utilisateurs actuels** : `APP_CHECK_SITE_KEY` (`js/firebase-config.js`)
est vide par défaut, donc `activateAppCheck()` ne fait rien tant
qu'une vraie clé n'y est pas renseignée manuellement. Ce qui reste à
faire n'est **pas du code** — seulement des actions dans les consoles
Firebase/Google Cloud, décrites ci-dessous — puis coller la clé
obtenue dans `APP_CHECK_SITE_KEY`. Le déploiement reste volontairement
progressif (mode monitoring d'abord, jamais d'enforcement brutal qui
risquerait de bloquer des utilisateurs existants sans test préalable).

## Pour la PWA (Web)

1. Dans la Firebase Console du projet `medconnect-e81ba` → App Check →
   ajouter l'app Web → fournisseur **reCAPTCHA Enterprise** (recommandé,
   remplace l'ancien reCAPTCHA v3 App Check désormais déprécié).
2. Créer une clé reCAPTCHA Enterprise dans Google Cloud Console, restreinte
   aux domaines réels de l'app :
   - `davekbg08-cloud.github.io` (GitHub Pages, chargé par l'APK Android
     ET l'app Electron desktop)
   - `medconnect-e81ba.web.app` / `medconnect-e81ba.firebaseapp.com`
     (Firebase Hosting)
3. **Côté code : déjà fait.** Une fois la clé reCAPTCHA Enterprise
   obtenue, il suffit de la coller dans `js/firebase-config.js` :
   ```js
   const APP_CHECK_SITE_KEY = "CLÉ_RECAPTCHA_ICI";
   ```
   `activateAppCheck()` (même fichier) s'occupe du reste
   (`firebase.appCheck().activate(new ReCaptchaEnterpriseProvider(...), true)`)
   automatiquement au chargement de l'app — aucun autre changement de
   code nécessaire.
4. **Ne jamais** inclure de clé privée/secrète côté client — seule la clé
   reCAPTCHA publique (site key) va dans le code, jamais une clé serveur.

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

- Créer la clé reCAPTCHA Enterprise et l'app Android dans la Firebase
  Console (actions manuelles, nécessitent un accès administrateur au
  projet Firebase — non disponibles dans cet environnement).
- Coller la clé obtenue dans `APP_CHECK_SITE_KEY`
  (`js/firebase-config.js`) — seule étape "code", une seule ligne.
- Documenter le SHA de production réel une fois extrait par le
  propriétaire du projet (le keystore n'est jamais accessible dans cet
  environnement de développement).

## Déjà fait dans ce dépôt (code, sans risque tant que la clé est vide)

- SDK `firebase-app-check-compat.js` (v9.22.0, même version que les
  autres SDK Firebase) chargé dans `index.html` et précaché dans
  `sw.js`.
- `js/firebase-config.js` : constante `APP_CHECK_SITE_KEY` (vide par
  défaut) + `activateAppCheck()`, appelée automatiquement par
  `initFirebase()`, no-op tant qu'aucune clé n'est renseignée.
- Tests : `tests/firebase-app-check.test.js` — vérifie que
  l'initialisation Firebase reste inchangée sans clé, que l'absence du
  SDK App Check ne plante jamais, et que l'activation appelle bien le
  bon fournisseur une fois une clé configurée.
