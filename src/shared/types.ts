// Tipos centrales compartidos entre servidor, Windows (Electron) y web móvil.

/** Estado de cualquier verificación o dato. Nunca se asume "Aprobado" sin prueba real. */
export const CHECK_STATUS = ['aprobado', 'fallido', 'pendiente', 'no_compatible', 'no_verificado'] as const;
export type CheckStatus = (typeof CHECK_STATUS)[number];
export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  aprobado: 'Aprobado',
  fallido: 'Fallido',
  pendiente: 'Pendiente',
  no_compatible: 'No compatible',
  no_verificado: 'No verificado',
};

export const CURRENCIES = ['UYU', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CONDITIONS = ['nuevo', 'usado'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const PRODUCT_STATUS = ['disponible', 'reservado', 'vendido', 'en_revision'] as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[number];

export const USES = ['gaming', 'fotos', 'redes', 'trabajo'] as const;
export type Use = (typeof USES)[number];

export const SPEC_GROUPS = [
  'Chip', 'Memoria', 'Pantalla', 'Cámaras', 'Batería y carga', 'Conectividad',
  'Dimensiones', 'Protección', 'Soporte', 'Otros',
] as const;
export type SpecGroup = (typeof SPEC_GROUPS)[number];

export interface Brand { id: number; name: string; isDemo: boolean }
export interface PhoneModel { id: number; brandId: number; name: string; releaseYear: number | null; isDemo: boolean }

/** Estado de verificación de cada dato de la ficha. */
export const SPEC_STATUSES = ['verificado', 'sin_confirmar', 'depende_variante', 'no_compatible', 'no_aplica'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];
export const SPEC_STATUS_LABEL: Record<SpecStatus, string> = {
  verificado: 'Verificado', sin_confirmar: 'Sin confirmar', depende_variante: 'Depende de la variante', no_compatible: 'No compatible', no_aplica: 'No aplica',
};
export interface SourceRef { name: string; url: string | null; date: string | null }

export interface Spec {
  id?: number;
  group: SpecGroup;
  key: string;
  value: string;
  /** En la ficha breve (chip, pantalla, batería...). */
  highlight: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
  /** Fecha ISO (YYYY-MM-DD) en que se consultó la fuente. */
  sourceDate: string | null;
  /** Verificado = fuente oficial de la variante o dos fuentes técnicas independientes. */
  status?: SpecStatus;
  /** Aclaración: qué dato falta, contradicciones, condiciones de medición. */
  note?: string | null;
  /** Otras fuentes que respaldan el mismo dato. */
  extraSources?: SourceRef[];
}

export interface Product {
  id: number;
  brandId: number;
  brand: string;
  modelId: number;
  model: string;
  variantId: number;
  storageGb: number | null;
  ramGb: number | null;
  region: string | null;
  color: string | null;
  condition: Condition;
  status: ProductStatus;
  price: number;
  currency: Currency;
  cost: number | null;
  stock: number;
  warrantyMonths: number;
  notes: string;
  uses: Use[];
  favorite: boolean;
  isDemo: boolean;
  /** 'manual' o 'drive' (sincronizado del catálogo de Google Sheets). */
  source: 'manual' | 'drive' | 'repo';
  /** ID del producto en el repo de datos (null si es local). */
  repoId: string | null;
  /** Descripción comercial (generada desde la ficha y editable). */
  description: string;
  /** Disponibilidad tal cual el catálogo (ej. "1 PANDO - 1 BU"). */
  availability: string;
  /** false si el catálogo no indica cantidades (se muestra «Disponible según catálogo»). */
  stockKnown: boolean;
  /** Primera foto del producto o null. */
  photoUrl: string | null;
  /** Clave de la portada oficial vinculada al modelo (data/covers.json), o null. */
  coverKey?: string | null;
  /** Especificaciones destacadas (máx. 4) para tarjetas. */
  highlights: Pick<Spec, 'group' | 'key' | 'value'>[];
  createdAt: string;
  updatedAt: string;
}

export const PHOTO_LICENSES = ['propia', 'autorizada_fabricante', 'autorizada_distribuidor'] as const;
export type PhotoLicense = (typeof PHOTO_LICENSES)[number];
export const PHOTO_LICENSE_LABEL: Record<PhotoLicense, string> = {
  propia: 'Foto propia del local', autorizada_fabricante: 'Autorizada por fabricante', autorizada_distribuidor: 'Autorizada por distribuidor',
};
export interface Photo { id: number; url: string; license: PhotoLicense }

export interface ProductDetail extends Product { specs: Spec[]; photos: Photo[]; benchmarks: Benchmark[] }

export interface Stats {
  products: number;
  stockTotal: number;
  favorites: number;
  /** Módulos aún no implementados: null = sin datos (nunca se inventa). */
  salesToday: number | null;
  tradeInsInProgress: number | null;
}

/** Payload de alta/edición. Marca/modelo/variante se crean o reutilizan por nombre. */
export interface ProductInput {
  brand: string;
  model: string;
  releaseYear?: number | null;
  storageGb?: number | null;
  ramGb?: number | null;
  region?: string | null;
  color?: string | null;
  condition: Condition;
  status?: ProductStatus;
  price: number;
  currency: Currency;
  cost?: number | null;
  stock?: number;
  warrantyMonths?: number;
  notes?: string;
  uses?: Use[];
  favorite?: boolean;
}

export interface ProductFilter {
  q?: string;
  condition?: Condition;
  brandId?: number;
  use?: Use;
  favorite?: boolean;
  includeDemo?: boolean;
}

export interface Settings {
  storeName: string;
  primaryColor: string;
  defaultCurrency: Currency;
  /** Cotización manual UYU por 1 USD. null = sin configurar (no se inventa). */
  usdRate: number | null;
  /** Logo como data URL (PNG/JPG/WebP ≤ 1 MB). null = logo por defecto. */
  logo: string | null;
  slogan: string;
  /** Link del catálogo en Google Sheets (debe estar compartido «Cualquier persona con el enlace»). */
}

export const DEFAULT_SETTINGS: Settings = {
  storeName: 'Celulares al Costo',
  primaryColor: '#22d3ee',
  defaultCurrency: 'USD',
  usdRate: null,
  logo: null,
  slogan: 'Gestión y venta de celulares, al costo.',
};


export interface CatalogExport {
  format: 'celulares-catalog';
  version: 1;
  exportedAt: string;
  products: (ProductInput & { specs: Spec[] })[];
}

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

// ---------- Benchmarks y comparador ----------
export const ANTUTU_VERSIONS = ['v12', 'v11', 'v10', 'v9'] as const;
export type AntutuVersion = (typeof ANTUTU_VERSIONS)[number];
export const PLATFORMS = ['android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const BENCH_SOURCES = ['AnTuTu (ranking oficial)', 'Kimovil', 'GSMArena', 'Nanoreview', 'Medición propia en el local', 'Otra'] as const;

export interface Benchmark {
  id?: number;
  modelId: number;
  version: AntutuVersion;
  platform: Platform;
  total: number;
  cpu: number | null; gpu: number | null; mem: number | null; ux: number | null;
  /** Variante medida (ej. "12 GB + 256 GB"). */
  variant: string | null;
  sourceName: string;
  sourceUrl: string | null;
  /** Fecha AAAA-MM-DD de la medición o de la consulta de la fuente. */
  measuredAt: string;
  notes: string;
  /** promedio de la base o medición individual (null = la fuente no lo indica). */
  sample?: 'promedio' | 'individual' | null;
}

export interface CompareModel {
  modelId: number;
  brand: string;
  model: string;
  releaseYear: number | null;
  isDemo: boolean;
  photoUrl: string | null;
  /** Clave de la portada oficial vinculada al modelo (data/covers.json), o null. */
  coverKey?: string | null;
  specs: Spec[];
  benchmarks: Benchmark[];
  /** Precio más bajo en catálogo con stock, por moneda. null si no hay. */
  priceFrom: { price: number; currency: Currency } | null;
  stock: number;
}

// ---- Cuentas ----
/** Correo del administrador: carga y edita productos, define la cotización y crea las cuentas de vendedores. */
export const ADMIN_EMAIL = 'celularesalcostopando@gmail.com';
export type Role = 'admin' | 'vendedor';
export interface SessionUser { email: string; role: Role }
export interface UserInfo { email: string; role: Role; createdAt: string }
export interface AuthStatus { user: SessionUser | null; adminEmail: string; needsSetup: boolean; setupReady: boolean }
