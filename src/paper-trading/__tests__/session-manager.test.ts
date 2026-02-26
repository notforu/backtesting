/**
 * Session Manager Tests (6E)
 *
 * Tests lifecycle management: create/start/stop/pause/resume/delete.
 * Mocks PaperTradingEngine and all DB calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaperSession } from '../types.js';
import type { AggregateBacktestConfig } from '../../core/signal-types.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock DB
vi.mock('../db.js', () => ({
  createPaperSession: vi.fn(),
  getPaperSession: vi.fn(),
  listPaperSessions: vi.fn(),
  updatePaperSession: vi.fn(),
  deletePaperSession: vi.fn(),
  getPaperPositions: vi.fn(),
  getPaperTrades: vi.fn(),
  savePaperEquitySnapshot: vi.fn(),
}));

// Mock PaperTradingEngine — use module-level fns so they can be reset in beforeEach
const mockEngineStart = vi.fn().mockResolvedValue(undefined);
const mockEngineStop = vi.fn().mockResolvedValue(undefined);
const mockEnginePause = vi.fn().mockResolvedValue(undefined);
const mockEngineResume = vi.fn().mockResolvedValue(undefined);
const mockEngineForceTick = vi.fn().mockResolvedValue({
  tickNumber: 1, timestamp: Date.now(), tradesOpened: [], tradesClosed: [],
  fundingPayments: [], equity: 10000, cash: 10000, positionsValue: 0, openPositions: [],
});
const mockEngineOn = vi.fn();

// Use function keyword so `new PaperTradingEngine(...)` works as a constructor
vi.mock('../engine.js', () => ({
  PaperTradingEngine: vi.fn().mockImplementation(function () {
    return {
      sessionId: 'mock-engine-session',
      status: 'stopped',
      start: mockEngineStart,
      stop: mockEngineStop,
      pause: mockEnginePause,
      resume: mockEngineResume,
      forceTick: mockEngineForceTick,
      on: mockEngineOn,
    };
  }),
}));

// Mock TelegramNotifier
vi.mock('../../notifications/telegram.js', () => ({
  TelegramNotifier: {
    isConfigured: vi.fn().mockReturnValue(false),
    fromEnv: vi.fn().mockReturnValue(null),
  },
}));

// ============================================================================
// Imports (after mock hoisting)
// ============================================================================

import { SessionManager } from '../session-manager.js';
import * as paperDb from '../db.js';

// ============================================================================
// Helpers
// ============================================================================

const testConfig: AggregateBacktestConfig = {
  subStrategies: [
    { strategyName: 'mock', symbol: 'BTC/USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
  ],
  allocationMode: 'single_strongest',
  maxPositions: 1,
  initialCapital: 10_000,
  startDate: 0,
  endDate: 1,
  exchange: 'bybit',
};

function makeSession(overrides: Partial<PaperSession> = {}): PaperSession {
  return {
    id: 'sess-001',
    name: 'Test Session',
    aggregationConfig: testConfig,
    aggregationConfigId: null,
    status: 'stopped',
    initialCapital: 10_000,
    currentEquity: 10_000,
    currentCash: 10_000,
    tickCount: 0,
    lastTickAt: null,
    nextTickAt: null,
    errorMessage: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SessionManager', () => {

  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager();

    // Default DB mocks
    vi.mocked(paperDb.createPaperSession).mockResolvedValue(makeSession());
    vi.mocked(paperDb.getPaperSession).mockResolvedValue(makeSession());
    vi.mocked(paperDb.listPaperSessions).mockResolvedValue([]);
    vi.mocked(paperDb.updatePaperSession).mockResolvedValue(undefined);
    vi.mocked(paperDb.deletePaperSession).mockResolvedValue(true);
    vi.mocked(paperDb.getPaperPositions).mockResolvedValue([]);
    vi.mocked(paperDb.getPaperTrades).mockResolvedValue({ trades: [], total: 0 });
  });

  // ==========================================================================
  // 1. Create session
  // ==========================================================================

  describe('createSession', () => {
    it('persists session to DB and returns it', async () => {
      const session = await manager.createSession({
        name: 'My Session',
        aggregationConfig: testConfig,
        initialCapital: 10_000,
      });

      expect(paperDb.createPaperSession).toHaveBeenCalledOnce();
      const createArg = vi.mocked(paperDb.createPaperSession).mock.calls[0][0];
      expect(createArg.name).toBe('My Session');
      expect(createArg.initialCapital).toBe(10_000);

      expect(session.id).toBe('sess-001');
    });

    it('uses config initialCapital when not explicitly provided', async () => {
      await manager.createSession({
        name: 'No Capital Override',
        aggregationConfig: { ...testConfig, initialCapital: 25_000 },
      });

      const createArg = vi.mocked(paperDb.createPaperSession).mock.calls[0][0];
      expect(createArg.initialCapital).toBe(25_000);
    });

    it('prefers explicit initialCapital over config value', async () => {
      await manager.createSession({
        name: 'Explicit Capital',
        aggregationConfig: { ...testConfig, initialCapital: 25_000 },
        initialCapital: 5_000, // explicit override
      });

      const createArg = vi.mocked(paperDb.createPaperSession).mock.calls[0][0];
      expect(createArg.initialCapital).toBe(5_000);
    });
  });

  // ==========================================================================
  // 2. Start → Stop lifecycle
  // ==========================================================================

  describe('startSession / stopSession', () => {
    it('creates engine and calls engine.start()', async () => {
      await manager.startSession('sess-001');

      expect(mockEngineStart).toHaveBeenCalledOnce();
      expect(manager.getEngine('sess-001')).toBeDefined();
    });

    it('throws if session not found in DB', async () => {
      vi.mocked(paperDb.getPaperSession).mockResolvedValueOnce(null);

      await expect(manager.startSession('nonexistent')).rejects.toThrow('not found');
    });

    it('stop calls engine.stop() and removes engine from memory', async () => {
      await manager.startSession('sess-001');
      await manager.stopSession('sess-001');

      expect(mockEngineStop).toHaveBeenCalledOnce();
      expect(manager.getEngine('sess-001')).toBeUndefined();
    });

    it('stop throws if no active engine', async () => {
      await expect(manager.stopSession('not-started')).rejects.toThrow('No active engine');
    });
  });

  // ==========================================================================
  // 3. Pause → Resume lifecycle
  // ==========================================================================

  describe('pauseSession / resumeSession', () => {
    it('pause calls engine.pause()', async () => {
      await manager.startSession('sess-001');
      await manager.pauseSession('sess-001');

      expect(mockEnginePause).toHaveBeenCalledOnce();
    });

    it('resume calls engine.resume()', async () => {
      await manager.startSession('sess-001');
      await manager.resumeSession('sess-001');

      expect(mockEngineResume).toHaveBeenCalledOnce();
    });

    it('pause throws if no active engine', async () => {
      await expect(manager.pauseSession('not-started')).rejects.toThrow('No active engine');
    });

    it('resume throws if no active engine', async () => {
      await expect(manager.resumeSession('not-started')).rejects.toThrow('No active engine');
    });
  });

  // ==========================================================================
  // 4. Delete session stops running engine first
  // ==========================================================================

  describe('deleteSession', () => {
    it('stops engine before deleting from DB', async () => {
      await manager.startSession('sess-001');

      const stopOrder: string[] = [];
      mockEngineStop.mockImplementationOnce(async () => { stopOrder.push('engine-stopped'); });
      vi.mocked(paperDb.deletePaperSession).mockImplementationOnce(async () => {
        stopOrder.push('db-deleted');
        return true;
      });

      await manager.deleteSession('sess-001');

      expect(stopOrder).toEqual(['engine-stopped', 'db-deleted']);
      expect(manager.getEngine('sess-001')).toBeUndefined();
    });

    it('deletes from DB even if no engine is running', async () => {
      await manager.deleteSession('sess-001');

      expect(mockEngineStop).not.toHaveBeenCalled();
      expect(paperDb.deletePaperSession).toHaveBeenCalledWith('sess-001');
    });
  });

  // ==========================================================================
  // 5. isRunning / activeCount
  // ==========================================================================

  describe('isRunning / activeCount', () => {
    it('isRunning returns false before start', () => {
      expect(manager.isRunning('sess-001')).toBe(false);
    });

    it('activeCount returns 0 initially', () => {
      expect(manager.activeCount).toBe(0);
    });

    it('activeCount increments after starting a session', async () => {
      await manager.startSession('sess-001');
      expect(manager.activeCount).toBe(1);
    });

    it('activeCount decrements after stopping a session', async () => {
      await manager.startSession('sess-001');
      await manager.stopSession('sess-001');
      expect(manager.activeCount).toBe(0);
    });
  });

  // ==========================================================================
  // 6. SSE subscription / unsubscribe
  // ==========================================================================

  describe('subscribe / unsubscribe', () => {
    it('subscribes a listener and returns unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = manager.subscribe('sess-001', listener);

      expect(typeof unsubscribe).toBe('function');

      // Unsubscribe should work without error
      expect(() => unsubscribe()).not.toThrow();
    });

    it('multiple listeners can be registered for same session', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();

      const unsub1 = manager.subscribe('sess-001', l1);
      manager.subscribe('sess-001', l2);

      // Unsubscribe one, other remains
      unsub1();

      // Verify no errors thrown
      expect(() => manager.subscribe('sess-001', vi.fn())).not.toThrow();
    });
  });

  // ==========================================================================
  // 7. forceTick: creates engine if not running, calls forceTick
  // ==========================================================================

  describe('forceTick', () => {
    it('calls engine.forceTick() and returns result', async () => {
      await manager.startSession('sess-001');
      const result = await manager.forceTick('sess-001');

      expect(mockEngineForceTick).toHaveBeenCalled();
      expect(result.tickNumber).toBe(1);
    });

    it('creates engine on-demand if not yet loaded', async () => {
      // Do NOT start the session — forceTick should create the engine
      const result = await manager.forceTick('sess-001');

      expect(paperDb.getPaperSession).toHaveBeenCalledWith('sess-001');
      expect(result.tickNumber).toBe(1);
    });

    it('throws if session not found during on-demand create', async () => {
      vi.mocked(paperDb.getPaperSession).mockResolvedValueOnce(null);

      await expect(manager.forceTick('not-found')).rejects.toThrow('not found');
    });
  });

  // ==========================================================================
  // 8. restoreActiveSessions: restarts sessions in 'running' state
  // ==========================================================================

  describe('restoreActiveSessions', () => {
    it('starts all sessions that had running status', async () => {
      const runningSession = makeSession({ id: 'running-1', status: 'running' });
      const stoppedSession = makeSession({ id: 'stopped-1', status: 'stopped' });

      vi.mocked(paperDb.listPaperSessions).mockResolvedValueOnce([runningSession, stoppedSession]);
      vi.mocked(paperDb.getPaperSession).mockResolvedValue(runningSession);

      await manager.restoreActiveSessions();

      // Only running session should have been started
      expect(mockEngineStart).toHaveBeenCalledTimes(1);
    });

    it('marks session as error if startup fails', async () => {
      const runningSession = makeSession({ id: 'failing-1', status: 'running' });
      vi.mocked(paperDb.listPaperSessions).mockResolvedValueOnce([runningSession]);
      vi.mocked(paperDb.getPaperSession).mockResolvedValueOnce(runningSession);
      mockEngineStart.mockRejectedValueOnce(new Error('Strategy load failed'));

      await manager.restoreActiveSessions();

      expect(paperDb.updatePaperSession).toHaveBeenCalledWith(
        'failing-1',
        expect.objectContaining({ status: 'error' }),
      );
    });
  });

  // ==========================================================================
  // 9. shutdownAll: pauses all active engines
  // ==========================================================================

  describe('shutdownAll', () => {
    it('pauses all running engines and clears memory', async () => {
      await manager.startSession('sess-001');

      await manager.shutdownAll();

      expect(mockEnginePause).toHaveBeenCalledOnce();
      expect(manager.activeCount).toBe(0);
    });

    it('gracefully handles pause errors during shutdown', async () => {
      await manager.startSession('sess-001');
      mockEnginePause.mockRejectedValueOnce(new Error('Engine error'));

      // Should NOT throw even if pause fails
      await expect(manager.shutdownAll()).resolves.not.toThrow();
    });
  });
});
