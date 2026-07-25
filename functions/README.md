# MedConnect — Cloud Functions (chantiers 6 & 7, v2.9.42)

Fonctions serveur qui suppriment la dépendance du client à la **lecture
publique de `mc_accounts`** et au **code de premier accès patient lisible côté
client**. Elles sont **App Check obligatoire** et **économes** (pas d'instance
chaude facturée au repos).

## Fonctions

| Fonction | Rôle | Entrée | Sortie |
|---|---|---|---|
| `authLookup` | Résout l'existence + le routage minimal d'un compte, sans exposer la collection | `{role, professionalNumber}` ou `{patientId}` | `{exists, uid, role, status, email}` ou `{exists:false}` |
| `claimPatientAccount` | Lie `mc_accounts/PAT_{id}` à l'uid de l'appelant après vérification **serveur** du code de premier accès | `{patientId, firstAccessCode}` (appelant authentifié) | `{ok, claimed}` ou erreur |
| `setVerifiedClientType` | Pose un custom claim `clientType` (desktop/mobile) vérifié à l'enrôlement, pour ne plus dépendre de `sourceDevice` | `{clientType}` | `{ok, clientType}` |

## Configuration coût (Blaze)

- **2e génération**, région **unique** (`europe-west1` par défaut, surchargeable
  par `MEDCONNECT_FUNCTIONS_REGION`).
- `minInstances: 0` → **aucune instance chaude** facturée au repos (démarrage à
  froid acceptable pour un appel de connexion ponctuel).
- `memory: 256MiB`, `maxInstances: 10` (garde-fou contre un emballement de coût).
- `enforceAppCheck: true` → tout appel sans jeton App Check valide est rejeté
  (réduit aussi les invocations abusives, donc le coût).

Estimation : à faible volume (quelques centaines de connexions/jour), le coût
reste dans le **quota gratuit** Cloud Functions (2 M invocations/mois). Le seul
coût réel vient des lectures Firestore par appel (1 à 3), négligeable.

## Déploiement (manuel, hors CI)

```bash
cd functions && npm install
firebase deploy --only functions          # déploie les 3 fonctions
```

## ⚠️ Ordre impératif (voir docs/DEPLOYMENT_v2.9.42.md)

1. **Déployer ces fonctions d'abord.**
2. Vérifier `authLookup` / `claimPatientAccount` sur un compte de test.
3. **Ensuite seulement** fermer la lecture publique de `mc_accounts`
   (`allow read: if true` → règle restreinte) et redéployer les règles.

Tant que l'étape 1 n'est pas faite, le client détecte l'absence des fonctions
(`firebase.functions` indisponible ou appel en échec) et conserve son chemin
actuel en repli — **rien ne casse avant le déploiement**.
