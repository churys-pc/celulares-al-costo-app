// Ejecución sin Electron: node dist/server.cjs  (abre la UI en http://127.0.0.1:5180)
import path from 'node:path';
import { startServer } from './main.ts';

startServer({ webRoot: path.join(__dirname, 'web'), port: Number(process.env.PORT ?? 5180) })
  .then((s) => console.log(`Servidor listo en ${s.url}`));
