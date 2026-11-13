import type { AuthStatus, UserInfo, Benchmark, CompareModel, Photo, Stats, Brand, CatalogExport, Product, ProductDetail, ProductFilter, ProductInput, Settings, Spec } from '../shared/types.ts';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // Sesión vencida o cerrada en otra pestaña: la app vuelve a la pantalla de ingreso.
  if (res.status === 401) window.dispatchEvent(new Event('auth:changed'));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== false) p.set(k, v === true ? '1' : String(v));
  return p.toString();
};

export interface SearchHit {
  type: 'product' | 'model'; productId: number | null; modelId: number; brand: string; model: string; variant: string;
  price: number | null; currency: 'USD' | 'UYU' | null; available: boolean; availabilityLabel: string; availability: string;
  coverKey: string | null; photoUrl: string | null;
}
export interface Task { id: string; title: string; description: string; done: boolean; createdBy: string | null; createdAt: string; updatedAt: string; completedAt: string | null }
export interface NewsItem { brand: string; title: string; date: string; summary: string; url: string; source: string; official: boolean }
export interface NewsState { items: NewsItem[]; fetchedAt: string | null; lastAttemptAt: string | null; error: string | null }

export const api = {
  search: (q: string) => call<SearchHit[]>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  tasks: () => call<Task[]>('GET', '/api/tasks'),
  addTask: (b: { title: string; description?: string }) => call<Task>('POST', '/api/tasks', b),
  updateTask: (id: string, b: Partial<Pick<Task, 'title' | 'description' | 'done'>>) => call<Task>('PATCH', `/api/tasks/${id}`, b),
  deleteTask: (id: string) => call<{ deleted: boolean }>('DELETE', `/api/tasks/${id}`),
  news: () => call<NewsState>('GET', '/api/news'),
  refreshNews: () => call<NewsState>('POST', '/api/news/refresh'),
  auth: () => call<AuthStatus>('GET', '/api/auth'),
  login: (email: string, password: string) => call<AuthStatus>('POST', '/api/auth/login', { email, password }),
  setupAdmin: (email: string, password: string) => call<AuthStatus>('POST', '/api/auth/setup', { email, password }),
  logout: () => call<AuthStatus>('POST', '/api/auth/logout'),
  changePassword: (current: string, password: string) => call<{ ok: boolean }>('POST', '/api/auth/password', { current, password }),
  fichas: () => call<{ total: number; withFicha: number; items: { modelId: number; brand: string; model: string; inStock: boolean; specs: number; verified: number; ficha: { id: string; variant: string; reviewedAt: string; pending: { key: string; why: string }[] } | null }[] }>('GET', '/api/fichas'),
  quickUpdate: (repoId: string, b: { price?: number; condition?: string; ramGb?: number | null; storageGb?: number | null; color?: string | null; photo?: string | null }) =>
    call<{ id: string; productId: number }>('PATCH', `/api/quick/products/${repoId}`, b),
  users: () => call<UserInfo[]>('GET', '/api/users'),
  addUser: (email: string, password: string) => call<UserInfo[]>('POST', '/api/users', { email, password }),
  resetUserPassword: (email: string, password: string) => call<UserInfo[]>('PUT', `/api/users/${encodeURIComponent(email)}/password`, { password }),
  removeUser: (email: string) => call<UserInfo[]>('DELETE', `/api/users/${encodeURIComponent(email)}`),
  settings: () => call<Settings>('GET', '/api/settings'),
  saveSettings: (s: Partial<Settings>) => call<Settings>('PUT', '/api/settings', s),
  brands: () => call<Brand[]>('GET', '/api/catalog/brands'),
  products: (f: ProductFilter) => call<Product[]>('GET', `/api/catalog/products?${qs({ ...f, includeDemo: f.includeDemo === false ? '0' : undefined })}`),
  product: (id: number) => call<ProductDetail>('GET', `/api/catalog/products/${id}`),
  create: (p: ProductInput) => call<ProductDetail>('POST', '/api/catalog/products', p),
  update: (id: number, p: ProductInput) => call<ProductDetail>('PUT', `/api/catalog/products/${id}`, p),
  remove: (id: number) => call<{ deleted: boolean }>('DELETE', `/api/catalog/products/${id}`),
  favorite: (id: number, favorite: boolean) => call('PUT', `/api/catalog/products/${id}/favorite`, { favorite }),
  saveSpecs: (modelId: number, specs: Spec[]) => call<Spec[]>('PUT', `/api/catalog/models/${modelId}/specs`, { specs }),
  exportCatalog: (includeDemo: boolean) => call<CatalogExport>('GET', `/api/catalog/export?${qs({ includeDemo })}`),
  importCatalog: (d: unknown) => call<{ products: number }>('POST', '/api/catalog/import', d),
  stats: (includeDemo: boolean) => call<Stats>('GET', `/api/stats?${qs({ includeDemo: includeDemo ? undefined : '0' })}`),
  addPhoto: (productId: number, dataUrl: string, license: string) => call<Photo[]>('POST', `/api/catalog/products/${productId}/photos`, { dataUrl, license }),
  removePhoto: (id: number) => call('DELETE', `/api/photos/${id}`),
  compareCandidates: (includeDemo: boolean) => call<{ modelId: number; brand: string; model: string; coverKey: string | null; isDemo: boolean; benches: number; specs: number }[]>('GET', `/api/compare/models?${qs({ includeDemo: includeDemo ? undefined : '0' })}`),
  lookup: (q: string) => call<{ slug: string; name: string }[]>('GET', `/api/lookup?q=${encodeURIComponent(q)}`),
  lookupImport: (slug: string) => call<{ modelId: number; name: string; specs: number; antutu: boolean }>('POST', '/api/lookup', { slug }),
  createModel: (brand: string, model: string) => call<{ modelId: number }>('POST', '/api/compare/models', { brand, model }),
  compare: (ids: number[]) => call<CompareModel[]>('GET', `/api/compare?ids=${ids.join(',')}`),
  saveBenchmark: (modelId: number, b: Partial<Benchmark>) => call<Benchmark[]>('POST', `/api/catalog/models/${modelId}/benchmarks`, b),
  deleteBenchmark: (id: number) => call('DELETE', `/api/benchmarks/${id}`),
  quickPreview: (name: string, slug?: string) => call<{ candidates: { slug: string; name: string }[]; match: any }>('POST', '/api/quick/preview', { name, slug }),
  quickSave: (b: unknown) => call<{ id: string; productId: number }>('POST', '/api/quick/products', b),
  quickDelete: (id: string) => call('DELETE', `/api/quick/products/${id}`),
  repoStatus: () => call<{ ok: boolean; at: string | null; message: string; pending: number; repo: string; hasToken: boolean; builtin: boolean }>('GET', '/api/repo'),
  repoSave: (b: { repo: string; token?: string }) => call<{ ok: boolean; at: string | null; message: string; pending: number; repo: string; hasToken: boolean; builtin: boolean }>('PUT', '/api/repo', b),
  repoSync: () => call<{ ok: boolean; at: string | null; message: string; pending: number; repo: string; hasToken: boolean; builtin: boolean }>('POST', '/api/repo/sync'),
};

/** Lee un archivo de imagen como data URL, reduciéndolo a máx. `maxSide` px (JPEG/WebP) para ahorrar espacio. */
export async function fileToDataUrl(file: File, maxSide = 1600, force?: 'image/jpeg'): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Formato no soportado (JPG, PNG o WebP)');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const ctx = c.getContext('2d')!;
  if (force) { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
  return c.toDataURL(force ?? (file.type === 'image/png' ? 'image/png' : 'image/jpeg'), 0.86);
}
