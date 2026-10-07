import { describe, expect, it } from 'vitest';
import { shouldReload } from './freshness';

describe('reloading for a newer build', () => {
  it('reloads when the live build is another one', () => {
    expect(shouldReload('a', 'b', null)).toBe(true);
    expect(shouldReload('a', 'a', null)).toBe(false);
  });

  it('does not try twice for the same build, so a stubborn cache cannot make it loop', () => {
    expect(shouldReload('a', 'b', 'b')).toBe(false);
    expect(shouldReload('a', 'c', 'b')).toBe(true);
  });

  it('stays put when either side is unknown', () => {
    expect(shouldReload('', 'b', null)).toBe(false);
    expect(shouldReload('a', undefined, null)).toBe(false);
    expect(shouldReload('a', '', null)).toBe(false);
    expect(shouldReload('a', 42, null)).toBe(false);
  });
});
