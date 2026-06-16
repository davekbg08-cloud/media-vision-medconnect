# MedConnect — Configuration Firebase

## Statut actuel

Le projet est connecté à Firebase :

- Projet : `medconnect-e81ba`
- Firestore : base `(default)` en `europe-west1`
- Application Web : `medconnect-web`
- Authentification : Email/Password à activer dans la console si ce n'est pas déjà fait

## Firebase Authentication

Dans la console Firebase :

1. Ouvre **Authentication**
2. Clique **Commencer**
3. Onglet **Sign-in method**
4. Active **Email/Password**
5. Crée ensuite un compte administrateur réel et ajoute-lui un rôle `admin` dans `users/{uid}`.

## Règles et index Firestore

Les fichiers sont déjà présents dans le projet :

- `firestore.rules`
- `firestore.indexes.json`
- `firebase.json`

Avec Firebase CLI :

```bash
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

## Collections utilisées

Firestore crée une collection au premier document écrit. MedConnect écrit maintenant dans :

- `users`
- `patients`
- `doctors`
- `nurses`
- `pharmacies`
- `hospitals`
- `medical_records`
- `prescriptions`
- `appointments`
- `notifications`
- `registration_requests`
- `establishments`
- `affiliation_requests`

Les anciennes collections `mc_*` restent présentes pour compatibilité locale pendant la migration.

## Déployer sur Firebase Hosting ou Netlify

Firebase Hosting :

```bash
firebase deploy --only hosting
```

Netlify reste possible, mais les règles/index Firestore doivent toujours être déployés via Firebase CLI ou la console Firebase.

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
