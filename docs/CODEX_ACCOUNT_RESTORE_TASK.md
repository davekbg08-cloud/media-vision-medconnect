# Tâche Codex — Restauration des comptes existants MedConnect

Objectif : corriger la restauration des comptes après installation / réinstallation, sans créer de doublons.

## Décision fonctionnelle

Ne pas présenter cela comme un simple “email de récupération”.

Le parcours doit être :

- Compte existant → se connecter et restaurer les données sauvegardées.
- Premier accès → créer le PIN / envoyer la demande seulement si le compte n’existe pas déjà.

## À corriger

### 1. Écran de connexion

Dans l’écran de connexion, pour tous les rôles, mettre la logique “compte existant” en premier.

Pour Médecin / Pharmacien / Infirmier :

- Renommer le champ email en :

```text
Email du compte existant
```

- Texte d’aide :

```text
Après installation ou réinstallation, cet email permet de restaurer vos données sauvegardées.
```

Ne pas utiliser le wording “email de récupération”.

### 2. Patient / utilisateur

Le patient doit aussi avoir un vrai parcours de connexion existante.

Dans le formulaire Patient :

- Le bouton principal doit être :

```text
Se connecter à mon dossier existant
```

- Ajouter un deuxième bouton séparé :

```text
Premier accès : créer mon PIN
```

### 3. Empêcher les doublons patient

La connexion Patient ne doit plus créer automatiquement un nouveau compte si aucun compte local n’est trouvé.

Nouvelle logique :

1. Synchroniser Firestore avant la connexion patient.
2. Chercher un compte existant avec :
   - role == patient
   - patient_id == numéro de fiche
3. Si le compte existe :
   - vérifier le PIN ;
   - restaurer la session ;
   - sauvegarder `mc_my_patient_id` ;
   - ouvrir le dossier.
4. Si aucun compte n’existe :
   - afficher un message clair :

```text
Aucun compte patient existant trouvé pour cette fiche. Si c’est votre premier accès, utilisez “Premier accès : créer mon PIN”.
```

5. Le bouton “Premier accès : créer mon PIN” est le seul endroit autorisé à créer un nouveau PIN.

### 4. Empêcher les doublons professionnels

Avant toute inscription Médecin / Pharmacien / Infirmier :

1. Synchroniser Firestore.
2. Vérifier s’il existe déjà un compte avec le même :
   - rôle ;
   - numéro d’ordre / matricule ;
   - email si disponible.
3. Si un compte existe déjà, ne pas créer un nouveau compte.
4. Afficher :

```text
Un compte existe déjà avec ces informations. Utilisez l’onglet Connexion pour restaurer le compte existant.
```

### 5. Firestore comme source officielle

localStorage doit rester seulement un cache.

La logique de restauration doit prioriser :

1. Firebase Auth si email/mot de passe existe.
2. Firestore users/{uid}.
3. Cache local seulement si Firestore n’est pas disponible.

### 6. Sécurité

Ne pas réactiver l’ancien admin local `mc_admin_config`.

Ne pas créer de compte doublon avec des identifiants déjà utilisés.

Ne pas masquer les erreurs Firestore : utiliser `console.warn` ou `console.error` avec un message clair.

### 7. Fichiers probables

À vérifier / modifier prudemment :

```text
js/auth.js
js/app.js
js/db.js
js/auth_restore.js
```

Ne pas modifier le design général.

### 8. Test attendu

Après correction, tester :

1. Nouvelle installation / données navigateur effacées.
2. Patient → “Se connecter à mon dossier existant”.
3. Patient → si compte existant : connexion sans créer de doublon.
4. Patient → si compte absent : message clair + bouton séparé “Premier accès”.
5. Médecin / Pharmacien / Infirmier → connexion avec numéro + mot de passe + email du compte existant.
6. Tentative d’inscription avec un numéro déjà utilisé → blocage + message clair.
