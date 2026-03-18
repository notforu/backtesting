/**
 * Settings Routes Tests
 *
 * Tests the kill switch settings API using Fastify inject().
 * All database calls are mocked — no real DB connection needed.
 *
 * Covers:
 *   - GET  /api/settings/kill-switch  — returns defaults when DB is empty
 *   - GET  /api/settings/kill-switch  — returns persisted values
 *   - PUT  /api/settings/kill-switch/pt — updates enabled flag
 *   - PUT  /api/settings/kill-switch/pt — updates ddPercent
 *   - PUT  /api/settings/kill-switch/lt — updates live trading switch
 *   - PUT  /api/settings/kill-switch/pt — validates input (rejects bad ddPercent)
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ============================================================================
// Hoisted mock functions
// ============================================================================

const mockGetPlatformSetting = vi.fn();
const mockSetPlatformSetting = vi.fn();

// ============================================================================
// Module mocks — must be declared before importing the route module
// ============================================================================

vi.mock('../../../data/db.js', () => ({
  getPlatformSetting: (...args: unknown[]) => mockGetPlatformSetting(...args),
  setPlatformSetting: (...args: unknown[]) => mockSetPlatformSetting(...args),
}));

import { settingsRoutes } from '../settings.js';

// ============================================================================
// Fixtures
// ============================================================================

const DEFAULT_CONFIG = { enabled: true, ddPercent: 30 };

// ============================================================================
// Setup
// ============================================================================

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(settingsRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: both settings missing from DB
  mockGetPlatformSetting.mockResolvedValue(null);
  mockSetPlatformSetting.mockResolvedValue(undefined);
});

// ============================================================================
// GET /api/settings/kill-switch
// ============================================================================

describe('GET /api/settings/kill-switch', () => {
  it('returns default values when no settings are stored in DB', async () => {
    mockGetPlatformSetting.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/kill-switch',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      pt: DEFAULT_CONFIG,
      lt: DEFAULT_CONFIG,
    });
  });

  it('returns persisted PT and LT values from DB', async () => {
    const ptConfig = { enabled: false, ddPercent: 20 };
    const ltConfig = { enabled: true, ddPercent: 15 };

    mockGetPlatformSetting.mockImplementation((key: string) => {
      if (key === 'kill_switch_pt') return Promise.resolve(ptConfig);
      if (key === 'kill_switch_lt') return Promise.resolve(ltConfig);
      return Promise.resolve(null);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/kill-switch',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ pt: ptConfig, lt: ltConfig });
  });

  it('falls back to defaults for partial DB records', async () => {
    // DB returns an object missing ddPercent
    mockGetPlatformSetting.mockResolvedValue({ enabled: false });

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/kill-switch',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // enabled comes from DB, ddPercent falls back to 30
    expect(body.pt).toEqual({ enabled: false, ddPercent: 30 });
  });

  it('returns 500 when DB throws', async () => {
    mockGetPlatformSetting.mockRejectedValue(new Error('DB connection failed'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/kill-switch',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe('INTERNAL_ERROR');
  });
});

// ============================================================================
// PUT /api/settings/kill-switch/pt
// ============================================================================

describe('PUT /api/settings/kill-switch/pt', () => {
  it('disables the kill switch and persists to DB', async () => {
    mockGetPlatformSetting.mockResolvedValue({ enabled: true, ddPercent: 30 });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/kill-switch/pt',
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.enabled).toBe(false);
    expect(body.ddPercent).toBe(30); // preserved from existing

    expect(mockSetPlatformSetting).toHaveBeenCalledWith('kill_switch_pt', {
      enabled: false,
      ddPercent: 30,
    });
  });

  it('updates ddPercent when provided', async () => {
    mockGetPlatformSetting.mockResolvedValue({ enabled: true, ddPercent: 30 });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/kill-switch/pt',
      payload: { enabled: true, ddPercent: 25 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ enabled: true, ddPercent: 25 });

    expect(mockSetPlatformSetting).toHaveBeenCalledWith('kill_switch_pt', {
      enabled: true,
      ddPercent: 25,
    });
  });

  it('uses default ddPercent when no existing setting exists and ddPercent is not supplied', async () => {
    mockGetPlatformSetting.mockResolvedValue(null); // no existing record

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/kill-switch/pt',
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ddPercent).toBe(30); // default
  });

  it('rejects invalid ddPercent (out of range)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/kill-switch/pt',
      payload: { enabled: true, ddPercent: 150 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('rejects request without enabled field', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/kill-switch/pt',
      payload: { ddPercent: 20 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 500 when DB setPlatformSetting throws', async () => {
    mockGetPlatformSetting.mockResolvedValue({ enabled: true, ddPercent: 30 });
    mockSetPlatformSetting.mockRejectedValue(new Error('Write failed'));

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/kill-switch/pt',
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe('INTERNAL_ERROR');
  });
});

// ============================================================================
// PUT /api/settings/kill-switch/lt
// ============================================================================

describe('PUT /api/settings/kill-switch/lt', () => {
  it('disables the live trading kill switch', async () => {
    mockGetPlatformSetting.mockResolvedValue({ enabled: true, ddPercent: 30 });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/kill-switch/lt',
      payload: { enabled: false, ddPercent: 10 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ enabled: false, ddPercent: 10 });

    expect(mockSetPlatformSetting).toHaveBeenCalledWith('kill_switch_lt', {
      enabled: false,
      ddPercent: 10,
    });
  });

  it('enables the live trading kill switch', async () => {
    mockGetPlatformSetting.mockResolvedValue({ enabled: false, ddPercent: 20 });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/kill-switch/lt',
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.enabled).toBe(true);
    expect(body.ddPercent).toBe(20); // preserved
  });
});
