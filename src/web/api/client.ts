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
  RunPairsBacktestRequest,
  PairsBacktestResult,
  StrategyDetails,
  StrategyInfo,
  ApiError,
  OptimizationRequest,
  OptimizationResult,
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

  const headers: HeadersInit = { ...options.headers };
  if (options.body) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
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
 * Run a pairs trading backtest
 */
export async function runPairsBacktest(
  config: RunPairsBacktestRequest
): Promise<PairsBacktestResult> {
  return apiFetch<PairsBacktestResult>('/backtest/pairs/run', {
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

/**
 * Delete all backtest history
 */
export async function deleteAllHistory(): Promise<{ message: string; count: number }> {
  return apiFetch<{ message: string; count: number }>('/backtest/history', {
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
// Optimization Endpoints
// ============================================================================

/**
 * Progress update callback for optimization
 */
export interface OptimizationProgressCallback {
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;
  onComplete?: (result: OptimizationResult & { duration: number }) => void;
  onError?: (error: string) => void;
}

/**
 * Run parameter optimization for a strategy with SSE progress updates
 */
export async function runOptimization(
  config: OptimizationRequest,
  callbacks?: OptimizationProgressCallback
): Promise<OptimizationResult> {
  const url = `${API_BASE}/optimize`;

  return new Promise((resolve, reject) => {
    // Use IIFE to handle async operations
    (async () => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        });

        if (!response.ok) {
          throw new ApiClientError(
            `API request failed: ${response.status} ${response.statusText}`,
            response.status
          );
        }

        if (!response.body) {
          throw new ApiClientError('Response body is null', 500);
        }

        // Read the SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Decode chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete messages (SSE format: "data: {...}\n\n")
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete message in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const dataStr = line.substring(6); // Remove "data: " prefix
            try {
              const data = JSON.parse(dataStr);

              switch (data.type) {
                case 'start':
                  // Optimization started
                  break;

                case 'progress':
                  // Progress update
                  if (callbacks?.onProgress) {
                    callbacks.onProgress({
                      current: data.current,
                      total: data.total,
                      percent: data.percent,
                    });
                  }
                  break;

                case 'complete':
                  // Optimization complete
                  if (callbacks?.onComplete) {
                    callbacks.onComplete(data.result);
                  }
                  resolve(data.result);
                  return;

                case 'error': {
                  // Error occurred
                  const errorMessage = data.error || 'Unknown error occurred';
                  if (callbacks?.onError) {
                    callbacks.onError(errorMessage);
                  }
                  reject(new ApiClientError(errorMessage, 500, data.details));
                  return;
                }

                default:
                  console.warn('Unknown SSE event type:', data.type);
              }
            } catch (err) {
              console.error('Error parsing SSE data:', err);
            }
          }
        }
      } catch (err) {
        console.error('Error during optimization:', err);
        if (err instanceof ApiClientError) {
          reject(err);
        } else if (err instanceof Error) {
          reject(new ApiClientError(err.message, 500));
        } else {
          reject(new ApiClientError('Unknown error occurred', 500));
        }
      }
    })();
  });
}

/**
 * Get all optimization runs for a strategy, symbol, and timeframe
 * Returns an array of results sorted by most recent first
 */
export async function getOptimizedParams(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<OptimizationResult[]> {
  return apiFetch<OptimizationResult[]>(
    `/optimize/${encodeURIComponent(strategyName)}/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}`
  );
}

/**
 * Get the most recent optimization run for a strategy, symbol, and timeframe
 */
export async function getLatestOptimizedParams(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<OptimizationResult> {
  return apiFetch<OptimizationResult>(
    `/optimize/${encodeURIComponent(strategyName)}/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}/latest`
  );
}

/**
 * Get all saved optimization results
 */
export async function getAllOptimizations(): Promise<OptimizationResult[]> {
  return apiFetch<OptimizationResult[]>('/optimize/all');
}

/**
 * Delete all optimization runs for a strategy, symbol, and timeframe
 */
export async function deleteOptimization(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<void> {
  return apiFetch<void>(
    `/optimize/${encodeURIComponent(strategyName)}/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * Delete a specific optimization run by ID
 */
export async function deleteOptimizationById(id: string): Promise<void> {
  return apiFetch<void>(
    `/optimize/id/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    }
  );
}

// ============================================================================
// Polymarket Endpoints
// ============================================================================

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  clobTokenIds: string;
  endDate: string;
  category: string;
  active: boolean;
  closed: boolean;
  liquidity: string;
  volume?: string;
  volumeNum?: number;
  image?: string;
}

/**
 * Search Polymarket markets with filters
 */
export async function searchPolymarketMarkets(params: {
  search?: string;
  category?: string;
  active?: string;
  closed?: string;
  limit?: number;
}): Promise<PolymarketMarket[]> {
  const queryParams = new URLSearchParams();
  if (params.search) queryParams.append('search', params.search);
  if (params.category) queryParams.append('category', params.category);
  if (params.active) queryParams.append('active', params.active);
  if (params.closed) queryParams.append('closed', params.closed);
  queryParams.append('limit', String(params.limit || 20));

  return apiFetch<PolymarketMarket[]>(`/polymarket/markets?${queryParams}`);
}

/**
 * Get available Polymarket categories
 */
export async function getPolymarketCategories(): Promise<string[]> {
  return apiFetch<string[]>('/polymarket/categories');
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
