# Celulares al Costo — App Windows

App de escritorio del local: catálogo, comparador (AnTuTu con fuente), diagnóstico iPhone y tasación.

- Estado, arquitectura y comandos: [PROJECT_STATUS.md](PROJECT_STATUS.md)
- **Publicar una actualización:** subir `version` en `package.json` y hacer push a `main` (sin tags).
  GitHub Actions genera el instalador y lo publica en
  [churys-pc/celulares-al-costo-releases](https://github.com/churys-pc/celulares-al-costo-releases);
  las PCs con la app instalada se actualizan solas.
