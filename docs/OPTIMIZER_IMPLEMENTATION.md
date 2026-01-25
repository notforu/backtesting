# Parameter Optimization Engine Implementation

## Overview

Implemented a complete parameter optimization system that uses grid search to find optimal strategy parameters. The system supports parallel execution, progress tracking, and persistent storage of optimization results.

## Files Created/Modified

### New Files

1. `/workspace/src/core/optimizer.ts` - Main optimization engine
2. `/workspace/test-optimizer.ts` - Test script for the optimizer

### Modified Files

1. `/workspace/src/data/db.ts` - Added optimized_params table and CRUD operations
2. `/workspace/src/api/routes/optimize.ts` - Updated to use new function names
3. `/workspace/src/data/index.ts` - Updated exports

## Core Features

### 1. Optimization Engine (`/workspace/src/core/optimizer.ts`)

**Main Function:**
```typescript
export async function runOptimization(
  config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void
): Promise<OptimizationResult>
```

**Key Capabilities:**

- **Grid Search**: Generates all parameter combinations from strategy param definitions
- **Parallel Execution**: Runs backtests in configurable batches (default: 4 concurrent)
- **Progress Tracking**: Optional callback for real-time progress updates
- **Result Tracking**: Stores all tested combinations and identifies best result
- **Automatic Saving**: Saves best parameters to database

**Configuration Options:**

```typescript
interface OptimizationConfig {
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  startDate: number;
  endDate: number;
  initialCapital: number;
  exchange: string;

  // Optimization specific
  paramRanges?: Record<string, { min: number; max: number; step: number }>;
  optimizeFor: 'sharpeRatio' | 'totalReturnPercent' | 'profitFactor' | 'winRate';
  maxCombinations?: number;  // Default: 1000
  batchSize?: number;        // Default: 4
}
```

**Parameter Range Sources:**

1. **Explicit ranges** via `paramRanges` config
2. **Strategy definition** via min/max/step in param schema
3. **Default value** if no range defined

**Optimization Metrics:**

- `sharpeRatio` - Risk-adjusted returns (default)
- `totalReturnPercent` - Raw percentage return
- `profitFactor` - Gross profit / gross loss
- `winRate` - Percentage of winning trades

### 2. Database Schema

**New Table: `optimized_params`**

```sql
CREATE TABLE IF NOT EXISTS optimized_params (
  id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  params JSON NOT NULL,
  metrics JSON NOT NULL,
  optimized_at INTEGER NOT NULL,
  config JSON NOT NULL,
  total_combinations INTEGER NOT NULL,
  tested_combinations INTEGER NOT NULL,
  UNIQUE(strategy_name, symbol)
);
```

**CRUD Functions:**

```typescript
// Save optimization result
export function saveOptimizedParams(result: OptimizationResult): void

// Get optimized params for a strategy/symbol
export function getOptimizedParams(
  strategyName: string,
  symbol: string
): OptimizationResult | null

// Get all optimized params
export function getAllOptimizedParams(): OptimizationResult[]

// Delete optimized params
export function deleteOptimizedParams(
  strategyName: string,
  symbol: string
): boolean
```

### 3. API Endpoints

**POST /api/optimize** - Run optimization
```json
{
  "strategyName": "sma-crossover",
  "symbol": "BTC/USDT",
  "timeframe": "1h",
  "startDate": 1704067200000,
  "endDate": 1706659200000,
  "initialCapital": 10000,
  "exchange": "binance",
  "optimizeFor": "sharpeRatio",
  "maxCombinations": 100,
  "batchSize": 4
}
```

**GET /api/optimize/:strategyName/:symbol** - Get saved results

**GET /api/optimize/all** - List all optimization results

**DELETE /api/optimize/:strategyName/:symbol** - Delete saved result

## Usage Examples

### 1. Programmatic Usage

```typescript
import { runOptimization } from './src/core/optimizer.js';

const result = await runOptimization({
  strategyName: 'sma-crossover',
  symbol: 'BTC/USDT',
  timeframe: '1h',
  startDate: Date.now() - 30 * 24 * 60 * 60 * 1000,
  endDate: Date.now(),
  initialCapital: 10000,
  exchange: 'binance',
  optimizeFor: 'sharpeRatio',
  maxCombinations: 100,
  batchSize: 4,
  paramRanges: {
    fastPeriod: { min: 5, max: 20, step: 5 },
    slowPeriod: { min: 20, max: 50, step: 10 }
  }
}, (progress) => {
  console.log(`${progress.percent.toFixed(1)}% complete`);
});

console.log('Best params:', result.bestParams);
console.log('Sharpe Ratio:', result.bestMetrics.sharpeRatio);
```

### 2. API Usage

```bash
# Run optimization
curl -X POST http://localhost:3000/api/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "strategyName": "sma-crossover",
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "startDate": 1704067200000,
    "endDate": 1706659200000,
    "optimizeFor": "sharpeRatio",
    "maxCombinations": 50
  }'

# Get saved results
curl http://localhost:3000/api/optimize/sma-crossover/BTC%2FUSDT
```

### 3. Test Script

```bash
# Run the test script
npx tsx test-optimizer.ts
```

## Algorithm Details

### Grid Search Process

1. **Load Strategy**: Import strategy and get parameter definitions
2. **Generate Combinations**: Create cartesian product of parameter ranges
3. **Limit Combinations**: Sample evenly if exceeding maxCombinations
4. **Batch Execution**: Run backtests in parallel batches
5. **Track Best**: Compare results using selected metric
6. **Save Results**: Persist best parameters to database

### Combination Generation

For a strategy with parameters:
- `fastPeriod: min=5, max=15, step=5` → [5, 10, 15]
- `slowPeriod: min=20, max=40, step=10` → [20, 30, 40]

Total combinations: 3 × 3 = 9

```
[
  { fastPeriod: 5, slowPeriod: 20 },
  { fastPeriod: 5, slowPeriod: 30 },
  { fastPeriod: 5, slowPeriod: 40 },
  { fastPeriod: 10, slowPeriod: 20 },
  { fastPeriod: 10, slowPeriod: 30 },
  ...
]
```

### Parallel Execution

Backtests are executed in batches using `Promise.all`:

```typescript
for (let i = 0; i < combinations.length; i += batchSize) {
  const batch = combinations.slice(i, i + batchSize);
  const batchPromises = batch.map(params => runBacktest(...));
  const batchResults = await Promise.all(batchPromises);
  // Process results...
}
```

This provides significant speedup while avoiding memory issues from running too many backtests simultaneously.

## Performance Considerations

### Combination Limits

- Default `maxCombinations`: 1000
- Recommended for quick tests: 20-100
- Recommended for thorough optimization: 500-2000
- Very large grids (>5000) may take significant time

### Batch Size

- Default: 4 concurrent backtests
- Lower values (2-3): More stable, less memory usage
- Higher values (6-8): Faster on powerful machines
- Consider CPU cores and available memory

### Time Estimates

For a strategy with typical complexity:
- 10 combinations: ~10-30 seconds
- 100 combinations: ~2-5 minutes
- 1000 combinations: ~20-50 minutes

Times vary based on:
- Data range (more candles = longer)
- Strategy complexity
- Number of trades executed
- Machine specifications

## Database Storage

The optimization result includes:

```typescript
interface OptimizationResult {
  id: string;
  strategyName: string;
  symbol: string;
  bestParams: Record<string, unknown>;
  bestMetrics: PerformanceMetrics;
  totalCombinations: number;
  testedCombinations: number;
  optimizedAt: number;
  allResults?: Array<{
    params: Record<string, unknown>;
    metrics: PerformanceMetrics;
  }>;
}
```

The `allResults` field stores ALL tested combinations, allowing:
- Post-analysis of parameter sensitivity
- Visualization of parameter space
- Re-ranking by different metrics
- Statistical analysis

## Testing

### Run Type Check
```bash
npm run typecheck
```

### Run Linter
```bash
npm run lint
```

### Test Optimizer
```bash
npx tsx test-optimizer.ts
```

The test script will:
1. Run optimization on SMA crossover strategy
2. Test with 20 parameter combinations
3. Display progress during execution
4. Show best parameters and metrics
5. Verify database storage

## Future Enhancements

Possible improvements:

1. **Walk-Forward Optimization**: Split data into in-sample/out-of-sample periods
2. **Smart Search**: Implement genetic algorithms or Bayesian optimization
3. **Multi-Objective**: Optimize for multiple metrics simultaneously
4. **Robustness Testing**: Test parameter stability across different markets
5. **Visualization**: Generate heatmaps and parameter sensitivity charts
6. **Overfitting Detection**: Add Monte Carlo permutation tests
7. **Portfolio Optimization**: Optimize across multiple symbols simultaneously

## Notes

- Optimization results are specific to the date range and symbol tested
- Past performance does not guarantee future results
- Consider using walk-forward analysis for more robust parameters
- Monitor for overfitting by testing on out-of-sample data
- The UNIQUE constraint on (strategy_name, symbol) means only the latest optimization is kept per strategy/symbol pair
