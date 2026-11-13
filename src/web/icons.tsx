// Íconos de línea propios (SVG), estilo uniforme 24x24, trazo 1.8.
const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  scan: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M8 9h8v6H8z',
  barcode: 'M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14',
  pulse: 'M3 12h4l3-7 4 14 3-7h4',
  swap: 'M4 8h14l-4-4M20 16H6l4 4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  phone: 'M8 2.5h8a2 2 0 012 2v15a2 2 0 01-2 2H8a2 2 0 01-2-2v-15a2 2 0 012-2zM11 18.5h2',
  cart: 'M3 4h2l2.4 11h10.2L20 8H6.2M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
  chip: 'M8 8h8v8H8zM5 5h14v14H5zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  storage: 'M5 4h14v16H5zM5 10h14M8 7h.01M8 13.5h8',
  camera: 'M4 7h3l2-2.5h6L17 7h3a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  screen: 'M7 2.5h10a1.5 1.5 0 011.5 1.5v16a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 20V4A1.5 1.5 0 017 2.5zM5.5 6h13M5.5 18h13',
  battery: 'M3 8h15a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V9a1 1 0 011-1zM22 11v2M5 11v2M8 11v2',
  wifi: 'M2 9a15 15 0 0120 0M5.5 12.5a10 10 0 0113 0M9 16a5 5 0 016 0M12 19.5h.01',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', arrow: 'M4 12h15M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18',
  flame: 'M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-2 4-2 5-1-1-3-2-3-5-3 3-5 6-5 10 0 4 3 7 7 7z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  dot: 'M12 13a1 1 0 100-2 1 1 0 000 2z',
  gamepad: 'M7 8h10a4 4 0 014 4v2a3 3 0 01-5.4 1.8L14.5 14h-5l-1.1 1.8A3 3 0 013 14v-2a4 4 0 014-4zM8 10.5v3M6.5 12h3M15.5 11.5h.01M17.5 13h.01',
  chat: 'M4 5h16v11H9l-5 4V5z',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  down: 'M6 9l6 6 6-6',
  news: 'M4 5h13v14H6a2 2 0 01-2-2V5zM17 9h3v8a2 2 0 01-2 2M7.5 9h6M7.5 12.5h6M7.5 16h4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  refresh: 'M20 11a8 8 0 00-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0014.3 4.9L20 16M20 20v-4h-4',
  task: 'M9 6h11M9 12h11M9 18h11M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2',
};
export type IconName = keyof typeof P;

export function Icon({ name, size = 20, className }: { name: IconName | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.dot} />
    </svg>
  );
}

export const SPEC_ICON: Record<string, IconName> = {
  Chip: 'chip', Memoria: 'storage', 'Cámaras': 'camera', Pantalla: 'screen', 'Batería y carga': 'battery',
  Conectividad: 'wifi', 'Protección': 'shield',
};
