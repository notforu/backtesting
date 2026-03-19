/**
 * Telegram notification module for paper trading alerts.
 * Uses the Bot API via built-in fetch — no additional dependencies.
 */

const TELEGRAM_API = 'https://api.telegram.org';

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  /**
   * Check if Telegram is configured via environment variables.
   */
  static isConfigured(): boolean {
    return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  }

  /**
   * Create a notifier from environment variables.
   * Returns null if not configured.
   */
  static fromEnv(): TelegramNotifier | null {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return null;
    return new TelegramNotifier(token, chatId);
  }

  /**
   * Send a raw message via Telegram Bot API.
   */
  async sendMessage(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<boolean> {
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Telegram] API error ${response.status}: ${errorBody}`);
        return false;
      }
      return true;
    } catch (error) {
      // Graceful failure: log but don't crash the engine
      console.error('[Telegram] Send failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  async notifyTradeOpened(trade: {
    symbol: string;
    action: string;
    price: number;
    amount: number;
    balanceAfter: number;
    sessionName?: string;
  }): Promise<void> {
    const direction = trade.action === 'open_long' ? '📈 LONG' : '📉 SHORT';
    const notional = (trade.price * trade.amount).toFixed(2);
    const msg = [
      `${direction} <b>${trade.symbol}</b>`,
      `Price: $${trade.price.toFixed(4)}`,
      `Size: $${notional}`,
      `Balance: $${trade.balanceAfter.toFixed(2)}`,
      trade.sessionName ? `Session: ${trade.sessionName}` : '',
    ].filter(Boolean).join('\n');
    await this.sendMessage(msg);
  }

  async notifyTradeClosed(trade: {
    symbol: string;
    action: string;
    price: number;
    amount: number;
    pnl: number | null;
    pnlPercent: number | null;
    fundingIncome: number;
    balanceAfter: number;
    sessionName?: string;
  }): Promise<void> {
    const pnl = trade.pnl ?? 0;
    const pnlPct = trade.pnlPercent ?? 0;
    const icon = pnl >= 0 ? '✅' : '❌';
    const msg = [
      `${icon} CLOSE <b>${trade.symbol}</b>`,
      `Price: $${trade.price.toFixed(4)}`,
      `PnL: $${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`,
      trade.fundingIncome !== 0 ? `Funding: $${trade.fundingIncome.toFixed(2)}` : '',
      `Balance: $${trade.balanceAfter.toFixed(2)}`,
      trade.sessionName ? `Session: ${trade.sessionName}` : '',
    ].filter(Boolean).join('\n');
    await this.sendMessage(msg);
  }

  async notifyDailySummary(summary: {
    sessionName: string;
    equity: number;
    initialCapital: number;
    openPositions: number;
    totalTrades: number;
    todayTrades: number;
    todayPnl: number;
  }): Promise<void> {
    const returnPct = (
      ((summary.equity - summary.initialCapital) / summary.initialCapital) *
      100
    ).toFixed(2);
    const msg = [
      `📊 <b>Daily Summary: ${summary.sessionName}</b>`,
      `Equity: $${summary.equity.toFixed(2)} (${Number(returnPct) >= 0 ? '+' : ''}${returnPct}%)`,
      `Open Positions: ${summary.openPositions}`,
      `Today's Trades: ${summary.todayTrades}`,
      `Today's PnL: $${summary.todayPnl.toFixed(2)}`,
      `Total Trades: ${summary.totalTrades}`,
    ].join('\n');
    await this.sendMessage(msg);
  }

  async notifySessionError(sessionName: string, error: string): Promise<void> {
    const msg = `🚨 <b>Error: ${sessionName}</b>\n${error}`;
    await this.sendMessage(msg);
  }

  async notifyUnifiedDailySummary(sessions: Array<{
    sessionName: string;
    equity: number;
    initialCapital: number;
    openPositions: number;
    totalTrades: number;
    todayTrades: number;
    todayPnl: number;
  }>): Promise<void> {
    if (sessions.length === 0) return;

    // Totals across all sessions
    const totalEquity = sessions.reduce((s, x) => s + x.equity, 0);
    const totalCapital = sessions.reduce((s, x) => s + x.initialCapital, 0);
    const totalOpen = sessions.reduce((s, x) => s + x.openPositions, 0);
    const totalTradesToday = sessions.reduce((s, x) => s + x.todayTrades, 0);
    const totalPnlToday = sessions.reduce((s, x) => s + x.todayPnl, 0);
    const totalTradesAll = sessions.reduce((s, x) => s + x.totalTrades, 0);
    const overallReturn = totalCapital > 0
      ? ((totalEquity - totalCapital) / totalCapital * 100).toFixed(2)
      : '0.00';

    const lines: string[] = [
      `📊 <b>Daily Digest (${sessions.length} sessions)</b>`,
      `Total Equity: $${totalEquity.toFixed(2)} (${Number(overallReturn) >= 0 ? '+' : ''}${overallReturn}%)`,
      `Open Positions: ${totalOpen}`,
      `Today: ${totalTradesToday} trades, PnL $${totalPnlToday.toFixed(2)}`,
      `All Time: ${totalTradesAll} trades`,
      '',
    ];

    // Per-session breakdown
    for (const s of sessions) {
      const ret = s.initialCapital > 0
        ? ((s.equity - s.initialCapital) / s.initialCapital * 100).toFixed(1)
        : '0.0';
      const pnlIcon = s.todayPnl >= 0 ? '🟢' : '🔴';
      lines.push(
        `${pnlIcon} <b>${s.sessionName}</b>: $${s.equity.toFixed(0)} (${Number(ret) >= 0 ? '+' : ''}${ret}%) | ${s.todayTrades}t ${s.todayPnl >= 0 ? '+' : ''}$${s.todayPnl.toFixed(0)}`,
      );
    }

    await this.sendMessage(lines.join('\n'));
  }

  async notifySessionStatusChange(
    sessionName: string,
    oldStatus: string,
    newStatus: string,
  ): Promise<void> {
    const icons: Record<string, string> = {
      running: '▶️',
      paused: '⏸️',
      stopped: '⏹️',
      error: '🚨',
    };
    const icon = icons[newStatus] ?? '🔄';
    const msg = `${icon} <b>${sessionName}</b>: ${oldStatus} → ${newStatus}`;
    await this.sendMessage(msg);
  }
}
