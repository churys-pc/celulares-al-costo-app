// «Pendientes del local»: notas de tareas del personal. Se guardan en SQLite (tabla tasks) y, si la PC está
// conectada al repo de datos, se comparten con las demás PCs como tasks/<id>.json (misma sincronización que el catálogo).
import crypto from 'node:crypto';
import type { Db } from './db.ts';
import { enqueue } from './repoSync.ts';
import { ValidationError } from '../shared/types.ts';

export const TASKS_DIR = 'tasks/';

export interface Task {
  id: string;
  title: string;
  description: string;
  done: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const ID_RE = /^[a-f0-9-]{36}$/;

function row(r: any): Task {
  return { id: r.id, title: r.title, description: r.description ?? '', done: !!r.done, createdBy: r.created_by ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at ?? null };
}

function clean(s: unknown, max: number) { return String(s ?? '').replace(/\r\n/g, '\n').trim().slice(0, max); }

export class TaskRepo {
  constructor(private db: Db) {}

  /** Abiertas primero (más nuevas arriba); después las completadas (la última completada arriba). */
  list(): Task[] {
    return this.db.prepare(`SELECT * FROM tasks ORDER BY done, CASE WHEN done = 1 THEN completed_at END DESC, created_at DESC`).all().map(row);
  }

  get(id: string): Task {
    const r = ID_RE.test(id) ? this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) : undefined;
    if (!r) throw new ValidationError('El pendiente no existe (puede que lo hayan borrado en otra PC).');
    return row(r);
  }

  create(body: any, by: string | null): Task {
    const title = clean(body?.title, 120);
    if (!title) throw new ValidationError('Escribí un título para el pendiente.');
    const now = new Date().toISOString();
    const t: Task = { id: crypto.randomUUID(), title, description: clean(body?.description, 2000), done: false,
      createdBy: by, createdAt: now, updatedAt: now, completedAt: null };
    this.save(t);
    return t;
  }

  update(id: string, body: any): Task {
    const t = this.get(id);
    if (body?.title !== undefined) {
      const title = clean(body.title, 120);
      if (!title) throw new ValidationError('El título no puede quedar vacío.');
      t.title = title;
    }
    if (body?.description !== undefined) t.description = clean(body.description, 2000);
    if (body?.done !== undefined && !!body.done !== t.done) {
      t.done = !!body.done;
      t.completedAt = t.done ? new Date().toISOString() : null;
    }
    t.updatedAt = new Date().toISOString();
    this.save(t);
    return t;
  }

  remove(id: string): boolean {
    this.get(id);
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    enqueue(this.db, `${TASKS_DIR}${id}.json`, 'delete');
    return true;
  }

  private save(t: Task) {
    upsert(this.db, t);
    enqueue(this.db, `${TASKS_DIR}${t.id}.json`, 'put', JSON.stringify(t, null, 1));
  }
}

function upsert(db: Db, t: Task) {
  db.prepare(`INSERT INTO tasks (id, title, description, done, created_by, created_at, updated_at, completed_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
    done = excluded.done, created_by = excluded.created_by, updated_at = excluded.updated_at, completed_at = excluded.completed_at`)
    .run(t.id, t.title, t.description, t.done ? 1 : 0, t.createdBy, t.createdAt, t.updatedAt, t.completedAt);
}

/** Aplica un pendiente bajado del repo (otra PC). Gana el cambio más reciente. */
export function applyTaskDoc(db: Db, doc: any) {
  if (!doc || !ID_RE.test(String(doc.id)) || !clean(doc.title, 120)) return;
  const cur = db.prepare('SELECT updated_at FROM tasks WHERE id = ?').get(doc.id);
  if (cur && String(cur.updated_at) > String(doc.updatedAt)) return;
  const now = new Date().toISOString();
  upsert(db, { id: doc.id, title: clean(doc.title, 120), description: clean(doc.description, 2000), done: !!doc.done,
    createdBy: doc.createdBy ? String(doc.createdBy) : null, createdAt: String(doc.createdAt ?? now), updatedAt: String(doc.updatedAt ?? now),
    completedAt: doc.done ? String(doc.completedAt ?? doc.updatedAt ?? now) : null });
}

export function removeTaskLocal(db: Db, id: string) { db.prepare('DELETE FROM tasks WHERE id = ?').run(id); }
