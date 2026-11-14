import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicates, parseMem } from '../src/shared/duplicates.ts';

const P = (id: number, brand: string, model: string, ramGb: number | null, storageGb: number | null, condition = 'nuevo') => ({ id, repoId: `r${id}`, brand, model, ramGb, storageGb, condition });
const list = [
  P(1, 'Samsung', 'Galaxy A55 5G', 8, 256), P(2, 'Samsung', 'Galaxy A55 5G', 8, 128), P(3, 'Samsung', 'Galaxy A15', 4, 128),
  P(4, 'Apple', 'iPhone 15', null, 128, 'usado'), P(5, 'Apple', 'iPhone 15 Pro', null, 256), P(6, 'Xiaomi', 'Redmi Note 14 Pro 5G', 8, 256),
];
const ids = (r: { same: { id: number }[]; similar: { id: number }[] }) => ({ same: r.same.map((p) => p.id), similar: r.similar.map((p) => p.id) });

test('Duplicados: memoria escrita en el nombre', () => {
  assert.deepEqual([parseMem('Galaxy A55 8/256').ram, parseMem('Galaxy A55 8/256').storage], [8, 256]);
  assert.equal(parseMem('iPhone 15 128GB').storage, 128);
  assert.equal(parseMem('iPhone 15 Pro 1 TB').storage, 1024);
});

test('Duplicados: mismo producto, misma memoria → «ya cargado»; otra memoria → parecido', () => {
  assert.deepEqual(ids(findDuplicates('Samsung Galaxy A55 5G 8/256', list)), { same: [1], similar: [2] });
  assert.deepEqual(ids(findDuplicates('galaxy a55 5g', list)), { same: [1, 2], similar: [] }, 'sin marca ni memoria: los dos');
  assert.deepEqual(ids(findDuplicates('Galaxy A55 5G 8/128 negro', list)), { same: [2], similar: [1] }, 'el color no cuenta');
});

test('Duplicados: parecidos por nombre contenido, sin confundir modelos distintos', () => {
  assert.deepEqual(ids(findDuplicates('iPhone 15 128GB', list)), { same: [4], similar: [5] });
  assert.deepEqual(ids(findDuplicates('Galaxy A56 8/256', list)), { same: [], similar: [] }, 'A56 no es A55');
  assert.deepEqual(ids(findDuplicates('Redmi Note 14 Pro+ 5G', list)), { same: [], similar: [] }, 'Pro+ no es Pro');
  assert.deepEqual(ids(findDuplicates('Galaxy', list)), { same: [], similar: [] }, 'sin número no avisa');
  assert.deepEqual(ids(findDuplicates('ip', list)), { same: [], similar: [] });
});

test('Duplicados: al editar no se avisa del mismo producto', () => {
  assert.deepEqual(ids(findDuplicates('Samsung Galaxy A55 5G 8/256', list, 'r1')), { same: [], similar: [2] });
});
