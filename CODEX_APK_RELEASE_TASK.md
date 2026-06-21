# Tâche Codex — APK MedConnect v2.4

Ce fichier sert de checklist directe pour terminer la génération APK sans chercher dans toute la conversation.

## Ce qui est déjà préparé

### PWA / cache

- `sw.js` utilise maintenant un cache incrémenté : `medconnect-v2.4-fastload`.
- Les fichiers HTML / JS / CSS utilisent une stratégie réseau prioritaire.
- Firebase / Firestore / Auth ne sont pas mis en cache.
- L’APK n’est pas listé dans le cache PWA.

### Session / restauration

- `js/app.js` contient une couche de restauration douce.
- Les comptes professionnels peuvent être restaurés après réinstallation via :
  - rôle ;
  - numéro professionnel ;
  - mot de passe ;
  - email Firebase Auth.
- Cette couche ne remplace pas brutalement `auth.js`.

### Android

- `android/app/build.gradle` est préparé pour :
  - `applicationId`: `com.mediavision.medconnect`
  - `namespace`: `com.mediavision.medconnect`
  - `versionCode`: `24`
  - `versionName`: `2.4.0`
- `MainActivity.java` charge maintenant la PWA officielle :

```text
https://davekbg08-cloud.github.io/media-vision-medconnect/?apk=v2.4.0
```

Donc l’APK doit afficher la même version que le navigateur.

### Workflow APK

Un workflow GitHub Actions est ajouté :

```text
.github/workflows/build-medconnect-apk.yml
```

Il génère un artefact :

```text
medconnect-v2.4-apk
```

Le fichier attendu dedans est :

```text
medconnect-v2.4.apk
```

## Ce que Codex doit faire maintenant

1. Vérifier que le projet Android compile.
2. Corriger uniquement les erreurs de compilation si nécessaire.
3. Ne pas modifier le design général.
4. Ne pas remettre l’ancien APK.
5. Ne pas réactiver l’admin local `mc_admin_config`.
6. Lancer le workflow GitHub Actions ou compiler localement :

```bash
cd android
gradle assembleRelease --no-daemon
```

ou si un wrapper Gradle est ajouté :

```bash
cd android
./gradlew assembleRelease
```

7. Récupérer le fichier généré :

```text
android/app/build/outputs/apk/release/app-release.apk
```

8. Le renommer :

```text
medconnect-v2.4.apk
```

9. Le placer dans :

```text
downloads/medconnect-v2.4.apk
```

10. Vérifier le lien final :

```text
https://davekbg08-cloud.github.io/media-vision-medconnect/downloads/medconnect-v2.4.apk
```

## Point de vigilance

Le dépôt ne doit pas publier un faux lien APK avant que le fichier APK réel soit présent.

Le fichier `downloads/README.md` existe seulement pour réserver l’emplacement du futur APK.
