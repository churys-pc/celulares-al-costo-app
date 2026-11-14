import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyTheme, loadTheme } from './theme.ts';

applyTheme(loadTheme(), false); // antes de pintar, para que no parpadee el color de fábrica
createRoot(document.getElementById('root')!).render(<App />);
