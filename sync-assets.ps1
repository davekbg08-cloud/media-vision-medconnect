# Script de synchronisation des fichiers web vers l'application Android
Write-Host "🔄 Synchronisation des fichiers web vers le projet Android..." -ForegroundColor Cyan

$assetsDir = "android\app\src\main\assets"

# Supprimer l'ancien contenu (css/js/assets/config) dans assets — ce
# script a longtemps été oublié (constaté : tout le module desktop
# hôpital et config/app-version.json manquaient dans l'APK). Le build
# CI (.github/workflows/build-medconnect-apk.yml) fait maintenant la
# même synchronisation automatiquement à chaque build, mais ce script
# reste utile pour tester un build Android en local.
if (Test-Path "$assetsDir\css") { Remove-Item -Path "$assetsDir\css" -Recurse -Force }
if (Test-Path "$assetsDir\js") { Remove-Item -Path "$assetsDir\js" -Recurse -Force }
if (Test-Path "$assetsDir\assets") { Remove-Item -Path "$assetsDir\assets" -Recurse -Force }
if (Test-Path "$assetsDir\config") { Remove-Item -Path "$assetsDir\config" -Recurse -Force }
if (Test-Path "$assetsDir\netlify.toml") { Remove-Item -Path "$assetsDir\netlify.toml" -Force }

# Recréer le dossier assets si nécessaire
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null

# Copier les fichiers à la racine
Copy-Item -Path "index.html" -Destination "$assetsDir\" -Force
Copy-Item -Path "manifest.json" -Destination "$assetsDir\" -Force
Copy-Item -Path "sw.js" -Destination "$assetsDir\" -Force

# Copier les répertoires css, js, assets (icônes) et config (version)
Copy-Item -Path "css" -Destination "$assetsDir\" -Recurse -Force
Copy-Item -Path "js" -Destination "$assetsDir\" -Recurse -Force
Copy-Item -Path "assets" -Destination "$assetsDir\" -Recurse -Force
Copy-Item -Path "config" -Destination "$assetsDir\" -Recurse -Force

Write-Host "✅ Synchronisation terminée avec succès !" -ForegroundColor Green
