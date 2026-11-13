@echo off
chcp 65001 >nul
title Celulares al Costo
cd /d "%~dp0"

rem 1) Node.js 22 o superior (se instala con winget si falta)
set "PATH=%PATH%;%ProgramFiles%\nodejs"
node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)" >nul 2>nul
if errorlevel 1 (
  echo Instalando Node.js LTS... si Windows pide permiso, acepta.
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
node -v || (echo No se pudo instalar Node.js. Instalalo desde https://nodejs.org y volve a abrir este archivo. & pause & exit /b 1)

rem 2) Dependencias (solo la primera vez)
if not exist node_modules\electron (
  echo Instalando dependencias, puede tardar unos minutos...
  call npm install || (echo Fallo npm install. & pause & exit /b 1)
)

rem 3) Abrir la app
call npm start
if errorlevel 1 pause
