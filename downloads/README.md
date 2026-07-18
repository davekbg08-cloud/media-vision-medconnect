# Téléchargements MedConnect

Ce dossier est réservé aux fichiers officiels publiés par Media Vision :
l'APK Android et les installeurs de bureau (Windows/Linux).

Fichiers attendus après génération (correctif audit : les noms
desktop précédents — medconnect-v1.0.0-setup.exe/.AppImage/.deb —
ne correspondaient ni à la version courante ni à la convention de
nommage réelle d'electron-builder, voir electron/package.json
`artifactName` et .github/workflows/build-desktop-app.yml) :

```text
medconnect-v2.9.31.apk
MedConnect-Setup-2.9.31.exe          (ou -unsigned-beta.exe si non signé)
MedConnect-2.9.31-<arch>.AppImage    (<arch> posé par electron-builder, ex. x86_64)
MedConnect-2.9.31-<arch>.deb         (<arch> posé par electron-builder, ex. amd64)
```

Liens finaux attendus :

```text
https://davekbg08-cloud.github.io/media-vision-medconnect/downloads/medconnect-v2.9.31.apk
https://davekbg08-cloud.github.io/media-vision-medconnect/downloads/MedConnect-Setup-2.9.31.exe
https://davekbg08-cloud.github.io/media-vision-medconnect/downloads/MedConnect-2.9.31-<arch>.AppImage
https://davekbg08-cloud.github.io/media-vision-medconnect/downloads/MedConnect-2.9.31-<arch>.deb
```

Important : ne pas remettre un ancien fichier ici sans mettre aussi à jour ce README.

APK : généré par `.github/workflows/build-medconnect-apk.yml` (artefact `medconnect-v2.9.31-apk`).
Bureau : généré par `.github/workflows/build-desktop-app.yml` (artefacts `medconnect-desktop-windows` / `medconnect-desktop-linux`, déclenchement manuel).
