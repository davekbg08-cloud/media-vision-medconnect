# Index central des projets — MediaVision / David Kabengele

Ce fichier sert de point d’entrée unique pour retrouver rapidement les projets et dépôts importants.

Important : ce fichier ne copie pas tout le code dans un seul dépôt. Il garde les projets séparés pour éviter de casser les applications, mélanger les configurations Firebase/Android/Netlify, ou exposer par erreur du code privé. Il sert de tableau de bord central.

## Dépôts

Compte GitHub : https://github.com/davekbg08-cloud

| Projet | Dépôt | Visibilité | Type | En ligne |
|--------|-------|------------|------|----------|
| MedConnect | [`media-vision-medconnect`](https://github.com/davekbg08-cloud/media-vision-medconnect) | public | PWA / Android / bureau — santé | https://davekbg08-cloud.github.io/media-vision-medconnect/ |
| Media Vision (site vitrine) | [`media-vision-site`](https://github.com/davekbg08-cloud/media-vision-site) | public | Site statique | https://davekbg08-cloud.github.io/media-vision-site/ (domaine perso : voir `DOMAINE.md` du dépôt) |
| Occasion | [`occasion`](https://github.com/davekbg08-cloud/occasion) | public | Flutter — marketplace | https://davekbg08-cloud.github.io/occasion/ |
| Ma Gestion | [`ma-gestion`](https://github.com/davekbg08-cloud/ma-gestion) | privé | Flutter — gestion Mobile Money | — |
| Longwei International | [`longwei-international`](https://github.com/davekbg08-cloud/longwei-international) | public | Site vitrine hôtelier trilingue | — |
| React Native Gallery | `react-native-gallery` | — | Copie du projet Microsoft, sans lien avec Media Vision | À archiver |

Ancien dépôt du site vitrine : `desktop-tutorial` (privé) — remplacé par `media-vision-site`.

### Notes par projet

- **MedConnect** : projet principal. Firebase Auth / Firestore / Functions, paiements pawaPay, APK dans `downloads/`.
- **Media Vision** : formulaires via FormSubmit, publication GitHub Pages automatique depuis `main`.
- **Occasion** : publication Play Store uniquement après confirmation explicite (voir `CLAUDE.md` du dépôt).
- **Ma Gestion** : opérateurs M-Pesa / Orange Money / Airtel Money / Afrimoney, stockage Hive + Firestore.
- **Longwei** : photos encore provisoires, à remplacer par les vraies.

## Règles de travail

1. Ne pas mélanger tous les codes dans un seul dossier.
2. Garder chaque projet dans son dépôt d’origine.
3. Utiliser ce fichier comme carte centrale pour ne plus chercher partout.
4. Ajouter ici tout nouveau projet dès sa création.
5. Avant modification importante, noter le dépôt concerné et l’objectif.
6. Ne pas rendre public un dépôt privé sans vérification des secrets, clés Firebase, APK, fichiers Android ou données personnelles.

## Priorités actuelles

1. Stabiliser MedConnect.
2. Brancher un nom de domaine sur le site Media Vision.
3. Remplacer les photos provisoires de Longwei International.
4. Archiver `react-native-gallery`.

## Commande utile pour Codex

```text
Lis d’abord PROJECTS_INDEX.md pour comprendre où se trouvent les projets.
Ne mélange pas les codes des projets.
Travaille uniquement dans le dépôt indiqué par la demande.
Si le projet demandé n’est pas dans ce fichier, demander confirmation avant de modifier.
```
