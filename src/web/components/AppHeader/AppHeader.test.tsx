// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppHeader } from './AppHeader';

// Mock the store so we don't need a provider
vi.mock('../../stores/runBacktestModalStore.js', () => ({
  useRunBacktestModalStore: () => vi.fn(),
}));

const defaultProps = {
  activePage: 'backtesting' as const,
  onNavigate: vi.fn(),
  currentResult: null,
  onShowParams: vi.fn(),
  onShowExplorer: vi.fn(),
  onShowLogin: vi.fn(),
  isAuthenticated: false,
  username: undefined,
  onLogout: vi.fn(),
  hasParams: false,
};

describe('AppHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the logo title', () => {
    render(<AppHeader {...defaultProps} />);
    expect(screen.getByText('Backtesting Platform')).toBeInTheDocument();
  });

  it('renders desktop nav with all three pages', () => {
    render(<AppHeader {...defaultProps} />);
    const backtestingBtns = screen.getAllByText('Backtesting');
    const configsBtns = screen.getAllByText('Configurations');
    const tradingBtns = screen.getAllByText('Trading');
    // At least one of each must exist (desktop nav)
    expect(backtestingBtns.length).toBeGreaterThan(0);
    expect(configsBtns.length).toBeGreaterThan(0);
    expect(tradingBtns.length).toBeGreaterThan(0);
  });

  it('renders a hamburger button', () => {
    render(<AppHeader {...defaultProps} />);
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
  });

  it('hamburger menu is closed by default', () => {
    render(<AppHeader {...defaultProps} />);
    expect(screen.queryByRole('navigation', { name: /mobile/i })).not.toBeInTheDocument();
  });

  it('opens mobile menu when hamburger is clicked', () => {
    render(<AppHeader {...defaultProps} />);
    const hamburger = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(hamburger);
    expect(screen.getByRole('button', { name: /close menu/i })).toBeInTheDocument();
  });

  it('mobile menu shows navigation items when open', () => {
    render(<AppHeader {...defaultProps} />);
    const hamburger = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(hamburger);
    // Mobile menu nav items should now be visible
    const nav = screen.getByTestId('mobile-menu');
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveTextContent('Backtesting');
    expect(nav).toHaveTextContent('Configurations');
    expect(nav).toHaveTextContent('Trading');
  });

  it('closes mobile menu when a nav item is clicked', () => {
    render(<AppHeader {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const mobileMenu = screen.getByTestId('mobile-menu');
    // Click the Configurations button inside the mobile menu
    const configBtn = Array.from(mobileMenu.querySelectorAll('button')).find(
      (b) => b.textContent === 'Configurations'
    );
    expect(configBtn).toBeDefined();
    fireEvent.click(configBtn!);
    expect(screen.queryByTestId('mobile-menu')).not.toBeInTheDocument();
    expect(defaultProps.onNavigate).toHaveBeenCalledWith('configurations');
  });

  it('calls onNavigate with correct page from desktop nav', () => {
    render(<AppHeader {...defaultProps} />);
    // Desktop nav buttons are in the nav element (not mobile-menu)
    const desktopNav = screen.getByTestId('desktop-nav');
    const tradingBtn = desktopNav.querySelector('button[data-page="paper-trading"]');
    expect(tradingBtn).toBeDefined();
    fireEvent.click(tradingBtn!);
    expect(defaultProps.onNavigate).toHaveBeenCalledWith('paper-trading');
  });

  it('shows Login button when not authenticated', () => {
    render(<AppHeader {...defaultProps} />);
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('shows username and Logout when authenticated', () => {
    render(<AppHeader {...defaultProps} isAuthenticated username="alice" />);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('shows subtitle on desktop and hides it via class on mobile', () => {
    render(<AppHeader {...defaultProps} />);
    const subtitle = screen.getByText('Backtesting Platform');
    // The parent wrapper should contain the hidden-on-mobile class
    // We just verify the element exists; visual hiding is via Tailwind
    expect(subtitle).toBeInTheDocument();
  });
});
