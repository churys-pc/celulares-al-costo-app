import type { IconName } from './icons.tsx';

export const SECTIONS: { id: string; label: string; icon: IconName; phase?: string; desc?: string; adminOnly?: boolean }[] = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'catalogo', label: 'Catálogo', icon: 'grid' },
  { id: 'cargar', label: 'Cargar productos', icon: 'plus', adminOnly: true },
  { id: 'comparador', label: 'Comparador', icon: 'layers', desc: 'Compará modelos, specs, AnTuTu y precios en detalle.' },
  { id: 'diagnostico', label: 'Diagnóstico', icon: 'pulse', phase: '2', desc: 'Conectá el iPhone por USB, abrí las pruebas en Safari con un QR y generá el informe.' },
  { id: 'ajustes', label: 'Ajustes', icon: 'gear' },
];

export interface Nav { go: (section: string, query?: string) => void }
