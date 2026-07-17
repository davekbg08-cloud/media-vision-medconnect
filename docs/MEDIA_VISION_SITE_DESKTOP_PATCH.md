# Patch pour media-vision-site — page Téléchargements (applications.html)

**Statut :** le dépôt `davekbg08-cloud/media-vision-site` n'était pas accessible
dans cette session (accès inter-dépôts non confirmé). Ce document fournit un
patch exact et prêt à appliquer par quelqu'un ayant accès à ce dépôt, ou par
une session Claude Code à laquelle ce dépôt aura été ajouté.

## Pourquoi

`applications.html` pointe actuellement vers des fichiers obsolètes :

- `medconnect-v2.6.0.apk` (l'APK réel est maintenant en v2.9.25, avec un vrai
  système de mise à jour intégré — voir CHANGELOG de l'app)
- une release desktop `v2.6.0-desktop` — **inexistante à ce jour** :
  `media-vision-medconnect` ne publiait encore aucun installateur desktop
  avant ce chantier (`fix/desktop-session-routing-packaging`, qui corrige les
  sessions, l'affichage des sections et le packaging Electron).

## 1–2. Liens à remplacer

| Ancien lien (à supprimer) | Nouveau lien |
|---|---|
| `.../downloads/medconnect-v2.6.0.apk` | `https://davekbg08-cloud.github.io/media-vision-medconnect/downloads/medconnect-v{VERSION_APK}.apk` |
| Release `v2.6.0-desktop` | Release GitHub `v{VERSION_DESKTOP}-desktop` du dépôt `media-vision-medconnect` (créée par `.github/workflows/build-desktop-app.yml`, `publish_release: true`) |

`{VERSION_APK}` et `{VERSION_DESKTOP}` doivent être lus dynamiquement (ou mis à
jour à chaque publication) — ne jamais coder une version en dur dans le HTML
sans processus de mise à jour, exactement le bug corrigé ici.

Vérifier la version APK actuelle via :
`https://davekbg08-cloud.github.io/media-vision-medconnect/config/app-version.json`
(champ `version`).

## 3. Informations à afficher pour CHAQUE téléchargement

Chaque bouton/carte de téléchargement doit afficher :

- **Plateforme** (Android / Windows / Linux)
- **Version** (ex. `2.9.25`)
- **Taille** du fichier (en Mo)
- **SHA-256** du fichier, ou un lien direct vers `SHA256SUMS.txt` de la même
  release/publication
- **Statut** : « Signé » ou « ⚠️ Bêta non signée » — jamais tu par défaut

Exemple de bloc HTML (à adapter au style du site) :

```html
<div class="download-card">
  <h3>🪟 Windows</h3>
  <p>Version {VERSION_DESKTOP} · <span id="win-size">—</span></p>
  <a href="{RELEASE_URL}/MedConnect-Setup-{VERSION_DESKTOP}-unsigned-beta.exe"
     class="btn-download">⬇️ Télécharger l'installateur (.exe)</a>
  <p class="badge-unsigned">⚠️ Bêta non signée — voir le guide d'installation</p>
  <p><a href="{RELEASE_URL}/SHA256SUMS.txt">Vérifier le SHA-256</a></p>
</div>
```

Dès qu'un certificat de signature de code sera configuré (secrets
`CSC_LINK`/`CSC_KEY_PASSWORD` du workflow), le nom du fichier perd
automatiquement le suffixe `-unsigned-beta` — mettre à jour le lien et
remplacer le badge par « ✅ Installateur signé ».

## 4. Trois guides SÉPARÉS et clairement identifiés

Structurer la page en trois sections distinctes, sans mélanger les
instructions d'une plateforme avec celles d'une autre :

- **A. Installer sur Android**
- **B. Installer sur Windows**
- **C. Installer sur Linux**

## 5. Guide Windows — contenu exact attendu

```
1. Cliquez sur "Télécharger l'installateur (.exe)".
2. Attendez que le fichier .crdownload (téléchargement en cours) disparaisse
   avant d'ouvrir le fichier — ne renommez JAMAIS manuellement un .crdownload
   en .exe, le fichier ne serait pas complet.
3. Selon le navigateur, un avertissement "Ce fichier est rarement téléchargé"
   (Edge) peut s'afficher : ne cliquez sur "Conserver" que si vous avez
   téléchargé depuis ce site officiel (medconnect... — jamais un lien reçu
   par un autre canal non vérifié).
4. (Recommandé) Vérifiez l'empreinte SHA-256 du fichier téléchargé contre
   celle publiée dans SHA256SUMS.txt, avec par exemple :
   Get-FileHash .\MedConnect-Setup-{VERSION_DESKTOP}-unsigned-beta.exe -Algorithm SHA256
5. Lancez l'installateur. Windows peut afficher "Windows a protégé votre
   ordinateur" (SmartScreen) — c'est attendu tant que l'installateur n'est
   pas signé numériquement (voir le statut affiché sur cette page). Cliquez
   sur "Informations complémentaires" puis "Exécuter quand même" UNIQUEMENT
   si vous avez téléchargé le fichier depuis cette page officielle et vérifié
   le SHA-256.
6. Cette bêta peut ne pas être signée numériquement (voir le badge sur le
   bouton de téléchargement) — c'est indiqué honnêtement ici, ce n'est pas
   un dysfonctionnement de votre part.
```

**Important :** ne jamais réutiliser l'instruction Android « Autoriser
l'installation d'applications inconnues » comme instruction pour Windows —
ce sont deux mécanismes différents (paramètre Android vs SmartScreen
Windows), et les mélanger induirait l'utilisateur en erreur sur ce qu'il
autorise réellement.

## 6. Guide Linux — contenu suggéré (non détaillé dans la demande initiale, ajouté par cohérence)

```
1. Téléchargez le fichier .AppImage (universel) ou .deb (Debian/Ubuntu).
2. AppImage : rendez le fichier exécutable puis lancez-le :
   chmod +x MedConnect-{VERSION_DESKTOP}-x86_64.AppImage
   ./MedConnect-{VERSION_DESKTOP}-x86_64.AppImage
3. .deb : sudo apt install ./MedConnect-{VERSION_DESKTOP}-amd64.deb
4. (Recommandé) Vérifiez le SHA-256 : sha256sum MedConnect-{VERSION_DESKTOP}-*.AppImage
```

## Résumé des remplacements

- [ ] Lien APK : v2.6.0 → v2.9.25 (ou version courante de `config/app-version.json`)
- [ ] Lien desktop : release `v2.6.0-desktop` (inexistante) → release réelle publiée par `build-desktop-app.yml`
- [ ] Ajout taille + SHA-256 (ou lien SHA256SUMS.txt) pour chaque fichier
- [ ] Ajout badge signé/non-signé pour Windows
- [ ] Séparation en 3 guides distincts (Android / Windows / Linux)
- [ ] Guide Windows : .crdownload, SmartScreen, vérification SHA-256, honnêteté sur le statut non signé
- [ ] Suppression de toute instruction Android réutilisée à tort pour Windows
