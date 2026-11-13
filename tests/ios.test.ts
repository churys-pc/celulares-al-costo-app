import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iosSupport } from '../src/shared/iosSupport.ts';

test('actualizaciones de iOS por modelo', () => {
  const s = (m: string) => iosSupport('Apple', m);
  assert.equal(s('iPhone 11')!.label, 'Recibe iOS 27 (la actual)');
  assert.equal(s('iPhone 11')!.estimate, 'Estimado: hasta 2026–2027 (no oficial)');
  assert.equal(s('iPhone 13 Pro Max')!.estimate, 'Estimado: hasta 2027–2028 (no oficial)');
  assert.equal(s('iPhone 16e')!.launchYear, 2025);
  assert.equal(s('iPhone Air')!.launchYear, 2025);
  assert.equal(s('iPhone 18 Pro Max')!.estimate, 'Estimado: hasta 2032–2033 (no oficial)');
  assert.equal(s('iPhone SE (3rd generation)')!.launchYear, 2022);
  assert.equal(s('iPhone 8 Plus')!.label, 'Llegó hasta iOS 16');
  assert.equal(s('iPhone XS Max')!.label, 'Llegó hasta iOS 18');
  assert.equal(s('iPhone XR')!.current, false);
  assert.equal(iosSupport('Samsung', 'Galaxy A55'), null);
});
