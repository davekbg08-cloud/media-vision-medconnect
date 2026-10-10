# MedConnect 2.0 — Vérifications Pré-Production

Ce fichier ne contient aucun identifiant réel, aucun mot de passe et aucun compte livré avec l'application.

## Comptes

- Les comptes de test livrés dans le code doivent rester absents.
- Les médecins doivent être ajoutés par l'administrateur avec un numéro d'ordre médical officiel.
- Les pharmaciens et infirmiers doivent être ajoutés avec leur numéro officiel.
- L'accès administrateur ne doit pas utiliser de mot de passe codé dans le dépôt.

## Parcours À Tester

1. Ajouter un médecin officiel au registre.
2. Inscrire ce médecin avec son numéro d'ordre officiel.
3. Valider le compte depuis l'administration.
4. Connecter le médecin validé.
5. Créer un patient et vérifier que son numéro MC est généré.
6. Connecter le patient avec son numéro MC et son PIN.
7. Inscrire et valider un pharmacien officiel.
8. Inscrire et valider un infirmier officiel.
9. Vérifier que chaque rôle voit uniquement les menus et données autorisés.

## Réinitialisation Locale

Pour nettoyer uniquement un environnement local de validation :

```javascript
localStorage.clear();
sessionStorage.clear();
location.reload();
```
