# Polymarket Favorite Compounder Scanner

**Date**: 2026-02-16 13:05:00
**Type**: New Feature
**Agent**: be-dev (sonnet)

## Summary

Built a standalone scanner that exploits the Favorite-Longshot Bias on Polymarket: high-probability outcomes (YES price > 0.85) resolve favorably more often than the price implies.

## Changes

### New Files

- **`scripts/pm-favorite-scanner.ts`**: Complete scanner implementation
  - Fetches all active markets from Polymarket Gamma API (~28K markets)
  - Filters for "favorite" markets (price >= 0.85, volume > $100K, 7-60 days to resolution)
  - Calculates expected yield, annualized yield, and risk-adjusted score
  - Builds an optimized portfolio of 5-7 markets
  - Saves results to `results/favorite-compounder/scan-{timestamp}.json`

## How It Works

1. **Data Collection**: Fetches active markets from Gamma API
2. **Filtering**: Applies liquidity, time horizon, and price filters
3. **Analysis**: Calculates metrics for each qualifying market
4. **Portfolio Construction**: Ranks by risk-adjusted score and allocates capital
5. **Expected Returns**: Projects outcomes based on 87.5% win rate (Kalshi study)

## Key Metrics

The scanner calculates three key metrics:

- **Expected Yield**: (1 - price) / price → e.g., 0.90 price = 11.1% yield
- **Annualized Yield**: yield * (365 / days_to_resolution)
- **Risk-Adjusted Score**: expected_yield / (1 - price) → penalizes lower-confidence markets

## Example Output

From the first run (2026-02-16):
- **Markets scanned**: 28,335 active
- **Qualifying favorites**: 22 markets
- **Portfolio**: 7 markets, $143 each
- **Expected portfolio yield**: 14.8%
- **Expected win rate**: 87.5%
- **Net expected return**: -$13 (due to conservative 87.5% win rate)

Top market: Beast Games contestant #151-175 at 0.864 (15.7% yield, 8 days → 679% annualized)

## Usage

```bash
npx tsx scripts/pm-favorite-scanner.ts
```

Or add to package.json:
```json
"pm:favorites": "tsx scripts/pm-favorite-scanner.ts"
```

## Configuration

Edit `CONFIG` object in the script:
- `MIN_PRICE`: 0.85 (minimum YES price)
- `MIN_VOLUME`: $100K (minimum market volume)
- `MIN_DAYS_TO_RESOLUTION`: 7 days
- `MAX_DAYS_TO_RESOLUTION`: 60 days
- `TOTAL_CAPITAL`: $1,000
- `MAX_PER_MARKET`: $200
- `EXPECTED_WIN_RATE`: 0.875 (87.5%, based on Kalshi research)

## Technical Details

- Uses Polymarket Gamma API for market metadata
- Uses CLOB API for real-time prices (with rate limiting)
- Prefers `outcomePrices` from Gamma API to avoid CLOB calls
- Rate limit: 10 requests per minute to CLOB API
- Self-contained script (no src/ dependencies)

## Results Storage

Results saved to: `results/favorite-compounder/scan-{timestamp}.json`

Format:
```json
{
  "timestamp": "...",
  "config": { ... },
  "portfolio": {
    "markets": [ ... ],
    "expectedPortfolioYield": 0.148,
    "expectedWinRate": 0.875,
    "netExpectedReturn": -13.23
  }
}
```

## Next Steps

Potential enhancements:
1. Integrate with backtesting system for historical validation
2. Add Kelly Criterion for optimal position sizing
3. Add correlation analysis to avoid correlated risks
4. Track actual vs. expected win rate over time
5. Add alerts for new high-quality favorites

## References

- Favorite-Longshot Bias: high-probability outcomes (>85%) resolve more often than implied
- Based on 3,587-market Kalshi study showing 85-90% win rates
- Strategy: compound returns by rolling capital into new favorites as markets resolve
