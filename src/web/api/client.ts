/**
 * API Client for the backtesting platform.
 * Provides typed functions for all API endpoints.
 */

import type {
  BacktestResult,
  BacktestSummary,
  Candle,
  CandleRequest,
  RunBacktestRequest,
  StrategyDetails,
  StrategyInfo,
  ApiError,
} from '../types';

const API_BASE = '/api';

/**
 * Custom error class for API errors
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
    let details: unknown;

    try {
      const errorData: ApiError = await response.json();
      errorMessage = errorData.message || errorMessage;
      details = errorData;
    } catch {
      // Response was not JSON, use default message
    }

    throw new ApiClientError(errorMessage, response.status, details);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// ============================================================================
// Backtest Endpoints
// ============================================================================

/**
 * Run a new backtest with the given configuration
 */
export async function runBacktest(
  config: RunBacktestRequest
): Promise<BacktestResult> {
  return apiFetch<BacktestResult>('/backtest/run', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/**
 * Get a specific backtest result by ID
 */
export async function getBacktest(id: string): Promise<BacktestResult> {
  return apiFetch<BacktestResult>(`/backtest/${encodeURIComponent(id)}`);
}

/**
 * Get list of all past backtest runs
 */
export async function getHistory(): Promise<BacktestSummary[]> {
  return apiFetch<BacktestSummary[]>('/backtest/history');
}

/**
 * Delete a backtest result
 */
export async function deleteBacktest(id: string): Promise<void> {
  return apiFetch<void>(`/backtest/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Strategy Endpoints
// ============================================================================

/**
 * Get list of all available strategies
 */
export async function getStrategies(): Promise<StrategyInfo[]> {
  return apiFetch<StrategyInfo[]>('/strategies');
}

/**
 * Get detailed information about a specific strategy
 */
export async function getStrategy(name: string): Promise<StrategyDetails> {
  return apiFetch<StrategyDetails>(`/strategies/${encodeURIComponent(name)}`);
}

// ============================================================================
// Data Endpoints
// ============================================================================

/**
 * Fetch candle data for charting
 */
export async function getCandles(params: CandleRequest): Promise<Candle[]> {
  const queryParams = new URLSearchParams({
    exchange: params.exchange,
    symbol: params.symbol,
    timeframe: params.timeframe,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  return apiFetch<Candle[]>(`/candles?${queryParams.toString()}`);
}

/**
 * Get available trading symbols for an exchange
 */
export async function getSymbols(exchange: string): Promise<string[]> {
  return apiFetch<string[]>(
    `/symbols?exchange=${encodeURIComponent(exchange)}`
  );
}

/**
 * Get list of supported exchanges
 */
export async function getExchanges(): Promise<string[]> {
  return apiFetch<string[]>('/exchanges');
}

// ============================================================================
// Health Check
// ============================================================================

interface HealthResponse {
  status: string;
  timestamp: string;
}

/**
 * Check if the API server is running
 */
export async function healthCheck(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health');
}
