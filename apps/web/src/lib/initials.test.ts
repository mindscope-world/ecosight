import { describe, expect, it } from 'vitest';
import { initials } from './format';

describe('the tile shown when an organisation has no logo', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Zuri Health')).toBe('ZH');
    expect(initials('eHealth IT Services PLC')).toBe('EI');
    expect(initials('8mg Health')).toBe('8H');
  });

  it('takes two letters of a single word, and copes with marks and nothing at all', () => {
    expect(initials('Kasha')).toBe('KA');
    expect(initials('I&E Health')).toBe('IE');
    expect(initials('Élan Santé')).toBe('ÉS');
    expect(initials('')).toBe('?');
  });
});
