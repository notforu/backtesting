/**
 * Platform Settings DB Function Tests
 *
 * Tests getPlatformSetting and setPlatformSetting.
 *
 * Because these functions live inside data/db.ts (which caches a module-level
 * pool), we test them via a mock of the pg Pool constructor so the functions
 * use our fake pool instead of a real PostgreSQL connection.
 *
 * Behavioral correctness at the API level is tested in:
 *   src/api/routes/__tests__/settings.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock pg — intercept Pool construction before db.ts is imported
// ============================================================================

const mockQuery = vi.fn();

// Pool must be a real constructor (class) for `new Pool(...)` to work
class MockPool {
  query = mockQuery;
  on = vi.fn();
}

vi.mock('pg', () => {
  return {
    default: { Pool: MockPool },
    Pool: MockPool,
  };
});

// Also mock fs/path to prevent migration file scanning at import time
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

// Import AFTER mocks are set up
const { getPlatformSetting, setPlatformSetting } = await import('../db.js');

// ============================================================================
// Helpers
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// getPlatformSetting
// ============================================================================

describe('getPlatformSetting', () => {
  it('returns null when the key is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getPlatformSetting('missing_key');

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT value FROM platform_settings'),
      ['missing_key'],
    );
  });

  it('returns the JSONB value when the key exists', async () => {
    const stored = { enabled: false, ddPercent: 20 };
    mockQuery.mockResolvedValueOnce({ rows: [{ value: stored }] });

    const result = await getPlatformSetting('kill_switch_pt');

    expect(result).toEqual(stored);
  });

  it('propagates DB errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(getPlatformSetting('x')).rejects.toThrow('Connection refused');
  });
});

// ============================================================================
// setPlatformSetting
// ============================================================================

describe('setPlatformSetting', () => {
  it('issues an UPSERT with the key and JSON-encoded value', async () => {
    mockQuery.mockResolvedValueOnce({});

    const value = { enabled: true, ddPercent: 30 };
    await setPlatformSetting('kill_switch_pt', value);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO platform_settings');
    expect(sql).toContain('ON CONFLICT (key) DO UPDATE');
    expect(params[0]).toBe('kill_switch_pt');
    expect(params[1]).toBe(JSON.stringify(value));
  });

  it('propagates DB errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Write failed'));

    await expect(setPlatformSetting('key', {})).rejects.toThrow('Write failed');
  });
});
