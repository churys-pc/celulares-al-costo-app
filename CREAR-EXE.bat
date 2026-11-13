@echo off
chcp 65001 >nul
title Crear .exe - Celulares al Costo
cd /d "%~dp0"

set "PATH=%PATH%;%ProgramFiles%\nodejs"
node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)" >nul 2>nul
if errorlevel 1 (
  echo Instalando Node.js LTS... si Windows pide permiso, acepta.
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
node -v || (echo No se pudo instalar Node.js. Instalalo desde https://nodejs.org y volve a abrir este archivo. & pause & exit /b 1)

echo.
echo [1/2] Instalando dependencias (solo la primera vez tarda)...
call npm install || (echo Fallo npm install. & pause & exit /b 1)

echo.
echo [2/2] Generando el .exe...
call npm run dist:win
if errorlevel 1 (
  echo.
  echo Reintentando sin editar metadatos del .exe ^(evita el error de permisos de Windows^)...
  call npx electron-builder --win --x64 -c.win.signAndEditExecutable=false || (echo No se pudo generar el .exe. Copia el texto de esta ventana y enviaselo a Claude. & pause & exit /b 1)
)

echo.
echo LISTO. En la carpeta "release" estan:
echo   - CelularesAlCosto-Setup-*.exe  (instala la app con acceso directo en el Escritorio)
start "" "%~dp0release"
pause
