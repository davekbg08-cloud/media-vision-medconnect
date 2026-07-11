# Sécurité de la clé Firebase Web — MedConnect

## Pourquoi cette clé est visible dans le navigateur

`js/firebase-config.js` (et sa copie synchronisée automatiquement dans
`android/app/src/main/assets/js/firebase-config.js`) contient une `apiKey`
Firebase commençant par `AIza...`. C'est **normal et attendu** : le SDK
Firebase Web ne peut fonctionner que si cette clé est chargée dans le
navigateur ou l'app. Toute personne qui ouvre les outils de développement
peut la voir — ce n'est pas une fuite, c'est le fonctionnement prévu par
Google.

## Pourquoi ce n'est PAS un mot de passe

Contrairement à une clé API classique (ex : clé serveur d'un service
payant), la clé Firebase Web sert uniquement à **identifier le projet
Firebase** auprès de Google — elle ne donne aucun droit de lecture/écriture
par elle-même. Un attaquant qui la récupère peut savoir "cette app parle au
projet Firebase X", rien de plus. Il ne peut ni lire ni modifier une seule
donnée sans passer par les vérifications décrites ci-dessous.

## Ce qui protège réellement les données : Firestore Rules + Firebase Authentication

La vraie barrière de sécurité est `firestore.rules` (déployé séparément de
la clé, jamais visible côté client) combiné à Firebase Authentication :
chaque lecture/écriture est vérifiée côté serveur Google, en fonction de
qui est connecté (`request.auth.uid`) et de son rôle réel. C'est pour ça
que tout le chantier de durcissement de ce dépôt porte sur `firestore.rules`
et non sur la clé elle-même — changer la clé sans corriger les règles ne
protégerait rien, et corriger les règles sans changer la clé règle déjà le
vrai problème.

## Comment activer Firebase App Check

App Check ajoute une couche supplémentaire qui vérifie que les requêtes
viennent bien de l'app MedConnect officielle (pas d'un script tiers qui
aurait copié la clé publique). Voir `docs/FIREBASE_APP_CHECK_SETUP.md` pour
la procédure détaillée (PWA via reCAPTCHA, Android via Play Integrity).

## Comment restreindre la clé Google dans Google Cloud Console

Action manuelle recommandée (hors dépôt, dans la Google Cloud Console du
projet `medconnect-e81ba`) :

1. **Restriction par API** : limiter la clé Web aux API réellement utilisées
   (Identity Toolkit, Firestore, Firebase Installations) — jamais à des API
   sensibles et payantes comme Generative Language API (Gemini), Google Maps,
   ou Places, sauf si l'app les utilise explicitement (à vérifier au cas par
   cas avant d'ajouter une restriction).
2. **Restriction par domaine web** (HTTP referrer) : limiter l'usage de la
   clé Web aux domaines réels de l'app (`davekbg08-cloud.github.io`,
   `medconnect-e81ba.web.app`/`.firebaseapp.com`, et le domaine du site
   vitrine si applicable).
3. **Clé Android distincte** : créer une clé séparée restreinte par nom de
   package (`com.medconnect.app`) et empreinte SHA-1/SHA-256 du certificat
   de signature — ne jamais réutiliser la clé Web dans l'APK au-delà de ce
   qui est déjà nécessaire au SDK Firebase.

## Comment traiter proprement une alerte GitHub (secret scanning)

Si GitHub signale la clé `AIza...` comme "secret détecté" : il s'agit très
probablement d'un faux positif pour une clé Firebase Web publique légitime
(voir audit de ce chantier : clé confirmée identique entre `js/firebase-config.js`
et sa copie Android, aucune autre occurrence anormale dans le dépôt ni son
historique). Marquer l'alerte comme "Used in tests" ou "False positive" dans
GitHub **seulement après avoir confirmé** via `node scripts/check-secrets.mjs`
qu'aucune autre valeur suspecte n'accompagne cette clé dans le même fichier.
Ne jamais ignorer une alerte sur un token GitHub, une clé privée PEM, ou un
`client_secret` — ceux-là sont toujours de vrais secrets à roter.

## Quand révoquer et recréer une clé

- **Jamais nécessaire** pour la clé Web actuelle tant qu'elle reste
  utilisée uniquement pour les API listées ci-dessus (Identity Toolkit,
  Firestore, Installations) et que les Firestore Rules restent la barrière
  réelle.
- **Révoquer et recréer immédiatement** si : la clé apparaît un jour associée
  à une API serveur payante sensible (Gemini, Maps Places, etc.) sans
  restriction, si un compte de service (`BEGIN PRIVATE KEY`) apparaît dans
  le dépôt ou son historique, ou si `scripts/check-secrets.mjs` détecte une
  valeur `AIza...` différente de celle documentée ci-dessus dans un fichier
  inattendu.
