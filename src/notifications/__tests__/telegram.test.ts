/**
 * Telegram Notifier Tests (6F)
 *
 * Tests message formatting, graceful failure on fetch errors,
 * env var configuration detection, and static factory methods.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramNotifier } from '../telegram.js';

// ============================================================================
// Mock global fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ============================================================================
// Helpers
// ============================================================================

function makeSuccessResponse() {
  return {
    ok: true,
    text: vi.fn().mockResolvedValue(''),
  };
}

function makeErrorResponse(status = 400, body = 'Bad Request') {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
  };
}

// Capture the last message sent to Telegram
function captureLastMessage(): Promise<string> {
  return new Promise(resolve => {
    mockFetch.mockImplementationOnce(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      resolve(body.text as string);
      return makeSuccessResponse();
    });
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('TelegramNotifier', () => {
  let notifier: TelegramNotifier;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    notifier = new TelegramNotifier('test-token', '-100123456');
    mockFetch.mockResolvedValue(makeSuccessResponse());
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  // ==========================================================================
  // 1. Message formatting — notifyTradeOpened
  // ==========================================================================

  describe('notifyTradeOpened', () => {
    it('formats long trade with symbol, price, size, balance', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyTradeOpened({
        symbol: 'BTC/USDT',
        action: 'open_long',
        price: 50_000,
        amount: 0.1,
        balanceAfter: 4_972.5,
      });

      const msg = await msgPromise;

      expect(msg).toContain('BTC/USDT');
      expect(msg).toContain('50000.0000');
      expect(msg).toContain('4972.50');
      // Notional: 50000 * 0.1 = 5000
      expect(msg).toContain('5000.00');
    });

    it('includes session name when provided', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyTradeOpened({
        symbol: 'ETH/USDT',
        action: 'open_long',
        price: 2_000,
        amount: 1,
        balanceAfter: 7_980,
        sessionName: 'My Trading Session',
      });

      const msg = await msgPromise;
      expect(msg).toContain('My Trading Session');
    });

    it('omits session line when sessionName not provided', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyTradeOpened({
        symbol: 'ETH/USDT',
        action: 'open_short',
        price: 2_000,
        amount: 1,
        balanceAfter: 7_980,
      });

      const msg = await msgPromise;
      expect(msg).not.toContain('Session:');
    });

    it('uses HTML parse mode', async () => {
      await notifier.notifyTradeOpened({
        symbol: 'BTC/USDT',
        action: 'open_long',
        price: 50_000,
        amount: 0.1,
        balanceAfter: 5_000,
      });

      const [_url, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body as string);
      expect(body.parse_mode).toBe('HTML');
    });
  });

  // ==========================================================================
  // 2. Message formatting — notifyTradeClosed
  // ==========================================================================

  describe('notifyTradeClosed', () => {
    it('formats profitable close with green icon and positive PnL', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyTradeClosed({
        symbol: 'BTC/USDT',
        action: 'close_long',
        price: 55_000,
        amount: 0.1,
        pnl: 500,
        pnlPercent: 10,
        fundingIncome: 0,
        balanceAfter: 10_500,
      });

      const msg = await msgPromise;
      expect(msg).toContain('500.00');
      expect(msg).toContain('+10.00%');
      expect(msg).toContain('BTC/USDT');
    });

    it('formats losing close with negative PnL indicator', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyTradeClosed({
        symbol: 'ETH/USDT',
        action: 'close_long',
        price: 1_800,
        amount: 1,
        pnl: -200,
        pnlPercent: -10,
        fundingIncome: 0,
        balanceAfter: 9_800,
      });

      const msg = await msgPromise;
      expect(msg).toContain('-200.00');
      expect(msg).toContain('-10.00%');
    });

    it('includes funding income when non-zero', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyTradeClosed({
        symbol: 'BTC/USDT',
        action: 'close_long',
        price: 55_000,
        amount: 0.1,
        pnl: 500,
        pnlPercent: 10,
        fundingIncome: 25.50,
        balanceAfter: 10_525.50,
      });

      const msg = await msgPromise;
      expect(msg).toContain('Funding');
      expect(msg).toContain('25.50');
    });

    it('omits funding line when fundingIncome is 0', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyTradeClosed({
        symbol: 'BTC/USDT',
        action: 'close_long',
        price: 55_000,
        amount: 0.1,
        pnl: 500,
        pnlPercent: 10,
        fundingIncome: 0,
        balanceAfter: 10_500,
      });

      const msg = await msgPromise;
      expect(msg).not.toContain('Funding');
    });

    it('handles null pnl and pnlPercent gracefully', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyTradeClosed({
        symbol: 'BTC/USDT',
        action: 'close_long',
        price: 55_000,
        amount: 0.1,
        pnl: null,
        pnlPercent: null,
        fundingIncome: 0,
        balanceAfter: 10_000,
      });

      // Should not throw
      const msg = await msgPromise;
      expect(msg).toContain('0.00');
    });
  });

  // ==========================================================================
  // 3. Message formatting — notifyDailySummary
  // ==========================================================================

  describe('notifyDailySummary', () => {
    it('formats daily summary with equity, return %, and trade counts', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyDailySummary({
        sessionName: 'Funding Rate Bot',
        equity: 11_000,
        initialCapital: 10_000,
        openPositions: 2,
        totalTrades: 15,
        todayTrades: 3,
        todayPnl: 120.5,
      });

      const msg = await msgPromise;
      expect(msg).toContain('Funding Rate Bot');
      expect(msg).toContain('11000.00');
      expect(msg).toContain('+10.00%');
      expect(msg).toContain('2'); // open positions
      expect(msg).toContain('15'); // total trades
      expect(msg).toContain('3'); // today trades
      expect(msg).toContain('120.50');
    });

    it('shows negative return for losses', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyDailySummary({
        sessionName: 'Test',
        equity: 9_000,
        initialCapital: 10_000,
        openPositions: 0,
        totalTrades: 5,
        todayTrades: 1,
        todayPnl: -100,
      });

      const msg = await msgPromise;
      expect(msg).toContain('-10.00%');
    });
  });

  // ==========================================================================
  // 4. Message formatting — notifySessionError
  // ==========================================================================

  describe('notifySessionError', () => {
    it('includes session name and error message in HTML format', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifySessionError('My Bot', 'Strategy load failed: file not found');

      const msg = await msgPromise;
      expect(msg).toContain('My Bot');
      expect(msg).toContain('Strategy load failed: file not found');
    });
  });

  // ==========================================================================
  // 5. Message formatting — notifySessionStatusChange
  // ==========================================================================

  describe('notifySessionStatusChange', () => {
    it('formats status change with old and new status', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifySessionStatusChange('Test Bot', 'stopped', 'running');

      const msg = await msgPromise;
      expect(msg).toContain('Test Bot');
      expect(msg).toContain('stopped');
      expect(msg).toContain('running');
    });

    it('includes appropriate icon for known statuses', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifySessionStatusChange('Bot', 'stopped', 'paused');

      const msg = await msgPromise;
      // Paused icon
      expect(msg).toContain('⏸️');
    });
  });

  // ==========================================================================
  // 6. Graceful failure: fetch throws → sendMessage returns false
  // ==========================================================================

  describe('sendMessage graceful failure', () => {
    it('returns false and does not throw when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await notifier.sendMessage('test message');
      expect(result).toBe(false);
    });

    it('returns false when API returns non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(400, 'Bad Request'));

      const result = await notifier.sendMessage('test message');
      expect(result).toBe(false);
    });

    it('returns true on successful send', async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());

      const result = await notifier.sendMessage('hello world');
      expect(result).toBe(true);
    });

    it('notifyTradeOpened does not throw when sendMessage fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        notifier.notifyTradeOpened({
          symbol: 'BTC/USDT',
          action: 'open_long',
          price: 50_000,
          amount: 0.1,
          balanceAfter: 5_000,
        }),
      ).resolves.not.toThrow();
    });

    it('notifyTradeClosed does not throw when sendMessage fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        notifier.notifyTradeClosed({
          symbol: 'BTC/USDT',
          action: 'close_long',
          price: 55_000,
          amount: 0.1,
          pnl: 500,
          pnlPercent: 10,
          fundingIncome: 0,
          balanceAfter: 10_500,
        }),
      ).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // 7. Env var guard: fromEnv() returns null when vars not set
  // ==========================================================================

  describe('fromEnv', () => {
    it('returns null when neither env var is set', () => {
      const notifier = TelegramNotifier.fromEnv();
      expect(notifier).toBeNull();
    });

    it('returns null when only TELEGRAM_BOT_TOKEN is set', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'some-token';
      const notifier = TelegramNotifier.fromEnv();
      expect(notifier).toBeNull();
    });

    it('returns null when only TELEGRAM_CHAT_ID is set', () => {
      process.env.TELEGRAM_CHAT_ID = '-100123';
      const notifier = TelegramNotifier.fromEnv();
      expect(notifier).toBeNull();
    });

    it('returns a TelegramNotifier when both env vars are set', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'bot-token-123';
      process.env.TELEGRAM_CHAT_ID = '-100456789';

      const notifier = TelegramNotifier.fromEnv();
      expect(notifier).toBeInstanceOf(TelegramNotifier);
    });
  });

  // ==========================================================================
  // 8. isConfigured: returns true/false based on env vars
  // ==========================================================================

  describe('isConfigured', () => {
    it('returns false when env vars not set', () => {
      expect(TelegramNotifier.isConfigured()).toBe(false);
    });

    it('returns false when only one env var is set', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'token';
      expect(TelegramNotifier.isConfigured()).toBe(false);
    });

    it('returns true when both env vars are set', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'token';
      process.env.TELEGRAM_CHAT_ID = '-100789';
      expect(TelegramNotifier.isConfigured()).toBe(true);
    });
  });

  // ==========================================================================
  // 9. notifyUnifiedDailySummary
  // ==========================================================================

  describe('notifyUnifiedDailySummary', () => {
    it('sends nothing when sessions array is empty', async () => {
      await notifier.notifyUnifiedDailySummary([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends a combined message for multiple sessions', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyUnifiedDailySummary([
        {
          sessionName: 'Bot A',
          equity: 11_000,
          initialCapital: 10_000,
          openPositions: 2,
          totalTrades: 20,
          todayTrades: 3,
          todayPnl: 150,
        },
        {
          sessionName: 'Bot B',
          equity: 9_500,
          initialCapital: 10_000,
          openPositions: 0,
          totalTrades: 10,
          todayTrades: 1,
          todayPnl: -50,
        },
      ]);

      const msg = await msgPromise;
      expect(msg).toContain('Daily Digest');
      expect(msg).toContain('2 sessions');
      expect(msg).toContain('Bot A');
      expect(msg).toContain('Bot B');
    });

    it('sums equity and capital correctly across sessions', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyUnifiedDailySummary([
        {
          sessionName: 'X',
          equity: 11_000,
          initialCapital: 10_000,
          openPositions: 1,
          totalTrades: 5,
          todayTrades: 1,
          todayPnl: 100,
        },
        {
          sessionName: 'Y',
          equity: 9_000,
          initialCapital: 10_000,
          openPositions: 0,
          totalTrades: 3,
          todayTrades: 0,
          todayPnl: 0,
        },
      ]);

      const msg = await msgPromise;
      // Total equity: 20000, total capital: 20000 → 0.00% return
      expect(msg).toContain('20000.00');
      expect(msg).toContain('0.00%');
      // Total open positions: 1
      expect(msg).toContain('Open Positions: 1');
      // Total trades today: 1
      expect(msg).toContain('Today: 1 trades');
    });

    it('shows overall return correctly for profitable portfolio', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyUnifiedDailySummary([
        {
          sessionName: 'Z',
          equity: 12_000,
          initialCapital: 10_000,
          openPositions: 0,
          totalTrades: 10,
          todayTrades: 2,
          todayPnl: 200,
        },
      ]);

      const msg = await msgPromise;
      // 20% return
      expect(msg).toContain('+20.00%');
    });

    it('shows negative return when portfolio is down', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyUnifiedDailySummary([
        {
          sessionName: 'Z',
          equity: 8_000,
          initialCapital: 10_000,
          openPositions: 0,
          totalTrades: 5,
          todayTrades: 1,
          todayPnl: -200,
        },
      ]);

      const msg = await msgPromise;
      // -20% return
      expect(msg).toContain('-20.00%');
    });

    it('sends a single Telegram call regardless of session count', async () => {
      mockFetch.mockResolvedValue(makeSuccessResponse());

      await notifier.notifyUnifiedDailySummary([
        { sessionName: 'A', equity: 10_000, initialCapital: 10_000, openPositions: 0, totalTrades: 1, todayTrades: 0, todayPnl: 0 },
        { sessionName: 'B', equity: 10_000, initialCapital: 10_000, openPositions: 0, totalTrades: 1, todayTrades: 0, todayPnl: 0 },
        { sessionName: 'C', equity: 10_000, initialCapital: 10_000, openPositions: 0, totalTrades: 1, todayTrades: 0, todayPnl: 0 },
      ]);

      // Only one fetch call regardless of 3 sessions
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('shows green icon for profitable sessions and red for losing sessions', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyUnifiedDailySummary([
        {
          sessionName: 'Profit Bot',
          equity: 10_500,
          initialCapital: 10_000,
          openPositions: 1,
          totalTrades: 5,
          todayTrades: 2,
          todayPnl: 100,
        },
        {
          sessionName: 'Loss Bot',
          equity: 9_500,
          initialCapital: 10_000,
          openPositions: 0,
          totalTrades: 3,
          todayTrades: 1,
          todayPnl: -50,
        },
      ]);

      const msg = await msgPromise;
      expect(msg).toContain('🟢');
      expect(msg).toContain('🔴');
    });

    it('handles zero initialCapital without dividing by zero', async () => {
      const msgPromise = captureLastMessage();

      await notifier.notifyUnifiedDailySummary([
        {
          sessionName: 'ZeroCapBot',
          equity: 0,
          initialCapital: 0,
          openPositions: 0,
          totalTrades: 0,
          todayTrades: 0,
          todayPnl: 0,
        },
      ]);

      const msg = await msgPromise;
      expect(msg).toContain('0.00%');
    });
  });

  // ==========================================================================
  // 10. Correct API URL format
  // ==========================================================================

  describe('sendMessage API call', () => {
    it('sends to correct Telegram Bot API URL', async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());

      await notifier.sendMessage('hello');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    });

    it('sends chat_id, text, and parse_mode in request body', async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());

      await notifier.sendMessage('test text', 'HTML');

      const [_url, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body as string);

      expect(body.chat_id).toBe('-100123456');
      expect(body.text).toBe('test text');
      expect(body.parse_mode).toBe('HTML');
      expect(body.disable_web_page_preview).toBe(true);
    });
  });
});
