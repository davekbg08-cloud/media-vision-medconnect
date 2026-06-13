# 🔥 MedConnect — Configuration Firebase

## ÉTAPE 1 — Créer le projet Firebase (5 min)

1. Va sur **https://console.firebase.google.com**
2. Clique **Créer un projet**
3. Nom du projet : `medconnect-app`
4. Google Analytics : Désactiver (pas nécessaire)
5. Clique **Créer le projet**

---

## ÉTAPE 2 — Activer Firestore

1. Dans le menu gauche → **Firestore Database**
2. Clique **Créer une base de données**
3. Choisir **Mode production**
4. Région : `europe-west1` (ou la plus proche de toi)
5. Clique **Activer**

---

## ÉTAPE 3 — Récupérer la configuration

1. Paramètres du projet (⚙️) → **Paramètres du projet**
2. Onglet **Général** → Descendre jusqu'à **Vos applications**
3. Clique l'icône **</>** (Web)
4. Nom de l'app : `medconnect-web`
5. Clique **Enregistrer l'application**
6. Copie le bloc `firebaseConfig` qui apparaît

---

## ÉTAPE 4 — Coller la config dans ton projet

Ouvre le fichier `js/firebase-config.js` et remplace :

```javascript
// REMPLACER CES VALEURS PAR CELLES DE TON PROJET FIREBASE :
const firebaseConfig = {
  apiKey:            "COLLE-TON-API-KEY-ICI",
  authDomain:        "TON-PROJET.firebaseapp.com",
  projectId:         "TON-PROJET",
  storageBucket:     "TON-PROJET.appspot.com",
  messagingSenderId: "TON-SENDER-ID",
  appId:             "TON-APP-ID"
};
```

---

## ÉTAPE 5 — Règles de sécurité Firestore

1. Firestore → onglet **Règles**
2. Remplacer par le contenu du fichier `firestore.rules`
3. Cliquer **Publier**

---

## ÉTAPE 6 — Déployer sur Netlify

1. Va sur **netlify.com**
2. Drag & drop le dossier `medconnect/`
3. L'app est en ligne avec Firebase !

---

## Ce que Firebase apporte

| Fonctionnalité | Avant (localStorage) | Après (Firebase) |
|---|---|---|
| Sync multi-appareils | ❌ | ✅ |
| Accès depuis n'importe quel téléphone | ❌ | ✅ |
| Données perdues si navigateur effacé | ❌ | ✅ Sauvegardées |
| Plusieurs médecins en même temps | ❌ | ✅ |
| Mise à jour en temps réel | ❌ | ✅ |

## Quota gratuit Firebase

| Limite | Gratuit |
|---|---|
| Lectures/jour | 50 000 |
| Écritures/jour | 20 000 |
| Stockage | 1 GB |
| Connexions simultanées | Illimitées |

Largement suffisant pour démarrer.
