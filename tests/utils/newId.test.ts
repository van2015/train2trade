import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../src/shared/utils/newId';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-123' });

    expect(newId('asset')).toBe('uuid-123');
  });

  it('falls back when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});

    const id = newId('asset');

    expect(id.startsWith('asset-')).toBe(true);
    expect(id).not.toBe(newId('asset'));
  });

  it('falls back when crypto is undefined', () => {
    vi.stubGlobal('crypto', undefined);

    expect(newId('indicator').startsWith('indicator-')).toBe(true);
  });
});
