# Script de synchronisation des fichiers web vers l'application Android
Write-Host "🔄 Synchronisation des fichiers web vers le projet Android..." -ForegroundColor Cyan

$assetsDir = "android\app\src\main\assets"

# Supprimer l'ancien contenu des dossiers css et js dans assets
if (Test-Path "$assetsDir\css") { Remove-Item -Path "$assetsDir\css" -Recurse -Force }
if (Test-Path "$assetsDir\js") { Remove-Item -Path "$assetsDir\js" -Recurse -Force }

# Recréer le dossier assets si nécessaire
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null

# Copier les fichiers à la racine
Copy-Item -Path "index.html" -Destination "$assetsDir\" -Force
Copy-Item -Path "manifest.json" -Destination "$assetsDir\" -Force
Copy-Item -Path "sw.js" -Destination "$assetsDir\" -Force

# Copier les répertoires css et js
Copy-Item -Path "css" -Destination "$assetsDir\" -Recurse -Force
Copy-Item -Path "js" -Destination "$assetsDir\" -Recurse -Force

Write-Host "✅ Synchronisation terminée avec succès !" -ForegroundColor Green
