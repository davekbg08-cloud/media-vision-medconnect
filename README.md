# MedConnect — Media Vision

Plateforme de coordination des soins (PWA + Android + bureau) reliant patients,
médecins, pharmaciens, infirmiers et établissements, avec des accès adaptés à chaque rôle.

- PWA : https://davekbg08-cloud.github.io/media-vision-medconnect/
- APK Android : [`downloads/`](downloads/) (version en cours : voir `config/app-version.json`)
- Nouveautés : [CHANGELOG.md](CHANGELOG.md)

## Stack

- Front : HTML / CSS / JavaScript (`index.html`, `js/`, `css/`), service worker `sw.js`
- Firebase : Auth, Firestore (`firestore.rules`), Cloud Functions (`functions/`), Hosting
- Android : `android/` (WebView) — application bureau : `electron/`
- Paiements : pawaPay (`functions/pawapay.js`)

## Commandes

```bash
npm install
npm run dev          # serveur local sur http://localhost:8080
npm test             # tests unitaires
npm run lint         # ESLint
npm run e2e          # tests Playwright
npm run test:rules   # tests des règles Firestore (émulateur)
npm run security:scan
```

## Organisation

| Dossier / fichier       | Contenu |
|-------------------------|---------|
| `js/`, `css/`, `assets/`| Application web |
| `functions/`            | Cloud Functions Firebase |
| `android/`, `playstore/`| Application Android et fiche Play Store |
| `electron/`             | Application bureau (Windows / Linux) |
| `scripts/`              | Migrations, sauvegardes, outils |
| `tests/`, `e2e/`        | Tests unitaires et de bout en bout |
| `docs/`                 | Guides : déploiement, sauvegarde/restauration, App Check, checklists |
| `.github/workflows/`    | Build APK/bureau, déploiements Firebase, sauvegardes, tests |
| `FIREBASE_SETUP.md`     | Configuration Firebase |
| `PROJECTS_INDEX.md`     | Carte de tous les projets Media Vision |

Ne jamais commiter de clés, keystores ou comptes de service (voir `.gitignore`).
