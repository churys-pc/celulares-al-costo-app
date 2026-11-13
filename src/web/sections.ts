import type { IconName } from './icons.tsx';

export const SECTIONS: { id: string; label: string; icon: IconName; phase?: string; desc?: string; adminOnly?: boolean }[] = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'catalogo', label: 'Catálogo', icon: 'grid' },
  { id: 'cargar', label: 'Cargar productos', icon: 'plus', adminOnly: true },
  { id: 'comparador', label: 'Comparador', icon: 'layers', desc: 'Compará modelos, specs, AnTuTu y precios en detalle.' },
  { id: 'imei', label: 'IMEI Check', icon: 'barcode', phase: '5', desc: 'Formato, red y bloqueos con fuentes autorizadas.' },
  { id: 'diagnostico', label: 'Diagnóstico', icon: 'pulse', phase: '2', desc: 'Pruebas desde Safari vía QR y obtené un informe.' },
  { id: 'ajustes', label: 'Ajustes', icon: 'gear' },
];

export interface Nav { go: (section: string, query?: string) => void }
