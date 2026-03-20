// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { TradesTable } from './TradesTable';
import type { Trade, PerformanceMetrics } from '../../types';

const mockMetrics: PerformanceMetrics = {
  totalReturn: 500,
  totalReturnPercent: 5,
  sharpeRatio: 1.2,
  maxDrawdown: 10,
  maxDrawdownPercent: 10,
  winRate: 55,
  totalTrades: 2,
  winningTrades: 1,
  losingTrades: 1,
  profitFactor: 1.8,
  avgWin: 250,
  avgLoss: -100,
  avgWinPercent: 2.5,
  avgLossPercent: -1.0,
  expectancy: 100,
  expectancyPercent: 1.0,
  largestWin: 250,
  largestLoss: -100,
  sortinoRatio: 1.5,
  avgTradeDuration: 3600000,
  exposureTime: 50,
  totalFees: 10,
  tradingPnl: 500,
  totalFundingIncome: undefined,
};

const mockFuturesMetrics: PerformanceMetrics = {
  ...mockMetrics,
  totalFundingIncome: 20,
};

const closeLongTrade: Trade = {
  id: 'trade-1',
  symbol: 'BTC/USDT',
  action: 'CLOSE_LONG',
  price: 50000,
  amount: 0.01,
  timestamp: 1700000000000,
  pnl: 150,
  pnlPercent: 3.5,
  fee: 5,
  slippage: 1,
  balanceAfter: 10150,
};

const openLongTrade: Trade = {
  id: 'trade-2',
  symbol: 'BTC/USDT',
  action: 'OPEN_LONG',
  price: 49000,
  amount: 0.01,
  timestamp: 1699990000000,
  fee: 5,
  slippage: 1,
  balanceAfter: 10000,
};

const futuresTrade: Trade = {
  ...closeLongTrade,
  id: 'trade-3',
  fundingIncome: 10,
  fundingRate: 0.0001,
};

describe('TradesTable', () => {
  it('renders the trades count heading', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    expect(screen.getByText(/Trades \(1\)/)).toBeInTheDocument();
  });

  it('renders asset label in heading when provided', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} assetLabel="BTC/USDT" />);
    expect(screen.getByText(/BTC\/USDT/)).toBeInTheDocument();
  });

  it('renders essential columns that are always visible', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    // These header cells must always be present
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('P&L')).toBeInTheDocument();
    expect(screen.getByText('Time')).toBeInTheDocument();
  });

  it('renders columns that are hidden on mobile with hidden md:table-cell class on # header', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    const hashHeader = screen.getByText('#');
    // Must have the hidden md:table-cell class so it hides on mobile
    expect(hashHeader).toHaveClass('hidden');
    expect(hashHeader).toHaveClass('md:table-cell');
  });

  it('renders Amount column header with hidden md:table-cell class', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    const amountHeader = screen.getByText('Amount');
    expect(amountHeader).toHaveClass('hidden');
    expect(amountHeader).toHaveClass('md:table-cell');
  });

  it('renders P&L % column header with hidden sm:table-cell class', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    const pnlPctHeader = screen.getByText('P&L %');
    expect(pnlPctHeader).toHaveClass('hidden');
    expect(pnlPctHeader).toHaveClass('sm:table-cell');
  });

  it('renders Cost column header with hidden lg:table-cell class', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    const costHeader = screen.getByText('Cost');
    expect(costHeader).toHaveClass('hidden');
    expect(costHeader).toHaveClass('lg:table-cell');
  });

  it('renders Balance column header with hidden sm:table-cell class', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    const balanceHeader = screen.getByText('Balance');
    expect(balanceHeader).toHaveClass('hidden');
    expect(balanceHeader).toHaveClass('sm:table-cell');
  });

  it('renders trade row with PnL for close trades', () => {
    render(<TradesTable trades={[closeLongTrade]} metrics={mockMetrics} />);
    expect(screen.getByText('+$150.00')).toBeInTheDocument();
  });

  it('renders dash for PnL on open trades', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    // PnL cells for open trades show '-'
    const pnlCells = screen.getAllByText('-');
    expect(pnlCells.length).toBeGreaterThan(0);
  });

  it('does not render PnL Clarity Banner when not futures mode', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    expect(screen.queryByText(/Trading P&L:/)).not.toBeInTheDocument();
  });

  it('renders PnL Clarity Banner in futures mode (non-multi-asset)', () => {
    render(<TradesTable trades={[futuresTrade]} metrics={mockFuturesMetrics} />);
    expect(screen.getByText(/Trading P&L:/)).toBeInTheDocument();
    expect(screen.getByText(/Funding Income:/)).toBeInTheDocument();
    expect(screen.getByText(/Total Return:/)).toBeInTheDocument();
  });

  it('PnL Clarity Banner uses responsive text size classes', () => {
    const { container } = render(<TradesTable trades={[futuresTrade]} metrics={mockFuturesMetrics} />);
    const banner = container.querySelector('.bg-blue-900\\/30');
    expect(banner).toBeInTheDocument();
    // Check reduced gap on mobile
    expect(banner).toHaveClass('gap-x-3');
    expect(banner).toHaveClass('sm:gap-x-6');
    // Check responsive text — banner itself carries text-xs sm:text-sm
    expect(banner).toHaveClass('text-xs');
    expect(banner).toHaveClass('sm:text-sm');
  });

  it('does not render PnL Clarity Banner in futures mode when showAssetColumn is true', () => {
    render(
      <TradesTable trades={[futuresTrade]} metrics={mockFuturesMetrics} showAssetColumn />
    );
    expect(screen.queryByText(/Trading P&L:/)).not.toBeInTheDocument();
  });

  it('renders Funding and FR Rate columns in futures mode', () => {
    render(<TradesTable trades={[futuresTrade]} metrics={mockFuturesMetrics} />);
    expect(screen.getByText('Funding')).toBeInTheDocument();
    expect(screen.getByText('FR Rate')).toBeInTheDocument();
  });

  it('renders Funding header with hidden md:table-cell class', () => {
    render(<TradesTable trades={[futuresTrade]} metrics={mockFuturesMetrics} />);
    const fundingHeader = screen.getByText('Funding');
    expect(fundingHeader).toHaveClass('hidden');
    expect(fundingHeader).toHaveClass('md:table-cell');
  });

  it('renders FR Rate header with hidden lg:table-cell class', () => {
    render(<TradesTable trades={[futuresTrade]} metrics={mockFuturesMetrics} />);
    const frRateHeader = screen.getByText('FR Rate');
    expect(frRateHeader).toHaveClass('hidden');
    expect(frRateHeader).toHaveClass('lg:table-cell');
  });

  it('renders Asset column when showAssetColumn is true', () => {
    render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} showAssetColumn />);
    expect(screen.getByText('Asset')).toBeInTheDocument();
  });

  it('table wrapper has overflow-x-auto class for fallback scrolling', () => {
    const { container } = render(<TradesTable trades={[openLongTrade]} metrics={mockMetrics} />);
    const wrapper = container.querySelector('.overflow-x-auto');
    expect(wrapper).toBeInTheDocument();
  });

  it('Time column shows date-only on mobile via responsive class', () => {
    render(<TradesTable trades={[closeLongTrade]} metrics={mockMetrics} />);
    // There should be an element with the mobile-only date span (block sm:hidden)
    const { container } = render(<TradesTable trades={[closeLongTrade]} metrics={mockMetrics} />);
    const mobileDateSpan = container.querySelector('.block.sm\\:hidden');
    expect(mobileDateSpan).toBeInTheDocument();
  });

  it('shows first 100 trades when more than 100 exist', () => {
    const manyTrades = Array.from({ length: 101 }, (_, i) => ({
      ...openLongTrade,
      id: `trade-${i}`,
    }));
    render(<TradesTable trades={manyTrades} metrics={mockMetrics} />);
    expect(screen.getByText(/Showing first 100 of 101 trades/)).toBeInTheDocument();
  });
});
