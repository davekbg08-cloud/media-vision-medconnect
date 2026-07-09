# Index central des projets — MediaVision / David Kabengele

Ce fichier sert de point d’entrée unique pour retrouver rapidement les projets et dépôts importants.

Important : ce fichier ne copie pas tout le code dans un seul dépôt. Il garde les projets séparés pour éviter de casser les applications, mélanger les configurations Firebase/Android/Netlify, ou exposer par erreur du code privé. Il sert de tableau de bord central.

## Dépôt central visible

Dépôt public utilisé comme point de repère :

- `davekbg08-cloud/media-vision-medconnect`
- Lien : `https://github.com/davekbg08-cloud/media-vision-medconnect`

## Projets connus

### 1. MedConnect

- Type : PWA / application médicale
- Dépôt : `davekbg08-cloud/media-vision-medconnect`
- Visibilité : public
- Lien GitHub : `https://github.com/davekbg08-cloud/media-vision-medconnect`
- Lien PWA : `https://davekbg08-cloud.github.io/media-vision-medconnect/`
- Statut : projet principal en cours de stabilisation
- Priorités : Firebase Auth, Firestore, suppression admin local, cohérence PWA/APK, cache service worker, localisation pharmacien

### 2. Media Vision — site vitrine

- Type : site web vitrine / entreprise
- Dépôt : `davekbg08-cloud/desktop-tutorial`
- Visibilité : privé
- Lien GitHub : `https://github.com/davekbg08-cloud/desktop-tutorial`
- Site : `https://media-vision.netlify.app/`
- Statut : site fonctionnel
- Notes : ne pas modifier inutilement pour éviter de casser le site ; contient formulaire Netlify, pages applications, confidentialité et conditions

### 3. React Native Gallery

- Type : dépôt existant / ancien projet ou test
- Dépôt : `davekbg08-cloud/react-native-gallery`
- Visibilité : selon GitHub
- Lien GitHub : `https://github.com/davekbg08-cloud/react-native-gallery`
- Statut : à vérifier plus tard si encore utile

### 4. Ma Gestion / Gestion Money

- Type : application de gestion mobile money / commissions
- Dépôt : non trouvé séparément pour l’instant
- Statut : à créer ou pousser sur GitHub plus tard si le code existe encore en local
- Notes connues : app de gestion Mobile Money avec SQLite, Firestore, transactions, commissions, opérateurs M-Pesa / Orange Money / Airtel Money / Africell

## Règles de travail

1. Ne pas mélanger tous les codes dans un seul dossier.
2. Garder chaque projet dans son dépôt d’origine.
3. Utiliser ce fichier comme carte centrale pour ne plus chercher partout.
4. Ajouter ici tout nouveau projet dès sa création.
5. Avant modification importante, noter le dépôt concerné et l’objectif.
6. Ne pas rendre public un dépôt privé sans vérification des secrets, clés Firebase, APK, fichiers Android ou données personnelles.

## Priorités actuelles

1. Stabiliser MedConnect.
2. Corriger les problèmes PWA/APK/Firebase de MedConnect.
3. Générer ensuite un nouvel APK propre.
4. Garder Media Vision stable.
5. Créer ou pousser Ma Gestion / Gestion Money dans un dépôt séparé quand le code sera disponible.

## Commande utile pour Codex

```text
Lis d’abord PROJECTS_INDEX.md pour comprendre où se trouvent les projets.
Ne mélange pas les codes des projets.
Travaille uniquement dans le dépôt indiqué par la demande.
Si le projet demandé n’est pas dans ce fichier, demander confirmation avant de modifier.
```
