# Publier MedConnect (Windows) sur le Microsoft Store

Avec le Store, c'est **Microsoft qui signe l'application** : pas de certificat
à acheter, et plus d'écran « Windows a protégé votre ordinateur ».
L'installeur `.exe` non signé reste disponible en parallèle sur les GitHub Releases.

Le paquet est construit par le workflow
`.github/workflows/build-msstore.yml` (déclenchement manuel).

## 1. Créer le compte développeur (une seule fois)

1. Aller sur https://storedeveloper.microsoft.com → **Get started** →
   compte **Individuel** (gratuit pour les particuliers) ou **Entreprise**.
2. Se connecter avec un compte Microsoft et vérifier son identité
   (pièce d'identité + selfie pour un compte individuel).

## 2. Réserver le nom et récupérer l'identité du paquet

1. Partner Center → **Apps et jeux** → **Nouveau produit** → **Application MSIX ou PWA**.
2. Réserver le nom **MedConnect** (ou une variante si déjà pris).
3. Ouvrir **Gestion des produits → Identité du produit** et noter :
   - `Package/Identity/Name` (ex. `12345MediaVision.MedConnect`)
   - `Package/Identity/Publisher` (ex. `CN=ABCD1234-...`)
   - `Package/Properties/PublisherDisplayName` (ex. `Media Vision`)

## 3. Renseigner les variables du dépôt GitHub

Dépôt `media-vision-medconnect` → **Settings → Secrets and variables →
Actions → onglet Variables** → **New repository variable** :

| Nom                              | Valeur (copiée de Partner Center)   |
|----------------------------------|-------------------------------------|
| `MSSTORE_IDENTITY_NAME`          | `Package/Identity/Name`             |
| `MSSTORE_PUBLISHER`              | `Package/Identity/Publisher`        |
| `MSSTORE_PUBLISHER_DISPLAY_NAME` | `Package/Properties/PublisherDisplayName` |

Ce ne sont pas des secrets : ces valeurs figurent dans le paquet publié.

## 4. Construire le paquet

**Actions → « Build MedConnect pour le Microsoft Store » → Run workflow**.
À la fin, télécharger l'artefact `medconnect-msstore` : il contient
`MedConnect-<version>-store.appx`.

Sans les variables de l'étape 3, le workflow produit un paquet de **test**
(identité fictive) : il sert à vérifier le build, mais le Store le refuse.

## 5. Soumettre dans Partner Center

Dans le produit MedConnect → **Démarrer la soumission** :

- **Tarification et disponibilité** : Gratuit ; marchés : tous, ou RDC + Afrique francophone.
- **Propriétés** : catégorie *Santé et remise en forme* (ou *Médecine*) ;
  URL de politique de confidentialité :
  `https://davekbg08-cloud.github.io/media-vision-medconnect/privacy.html`.
- **Classification par âge** : remplir le questionnaire IARC.
- **Packages** : déposer le fichier `.appx`.
- **Fiche du Store** (français) : description, au moins une capture d'écran
  (1366×768 ou plus), mots-clés.
- **Notes pour la certification** : expliquer que l'application nécessite un
  compte (médecin, pharmacien, patient…) et fournir un compte de test
  (fonctionnalités en lecture seule), sinon la certification peut échouer.

La certification prend en général de quelques heures à 3 jours ouvrés.

## Mises à jour

À chaque nouvelle version : relancer le workflow (la version vient de
`package.json`), puis créer une nouvelle soumission avec le nouveau `.appx`.
Le numéro de version doit toujours augmenter.

## Points d'attention

- L'application de bureau charge l'application web MedConnect (Firebase Hosting).
  Le Store refuse parfois les applications qui ne sont qu'un site web
  « emballé ». MedConnect a une page hors ligne et des rôles avec connexion,
  ce qui aide. Si la certification invoque la politique 10.1 (contenu limité),
  répondre en décrivant les fonctionnalités propres à l'application.
- L'application utilise la capacité `runFullTrust` (standard pour les
  applications Electron) : Partner Center demandera une courte justification,
  par exemple « Application de bureau Electron empaquetée en MSIX ».
