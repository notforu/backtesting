# Add Open Interest and Long/Short Ratio Data Caching Infrastructure

**Date:** 2026-03-05 18:10
**Type:** New Feature

## Summary

Added database tables, data provider methods, type definitions, and a CLI cache script for Open Interest (OI) and Long/Short Ratio (LSR) data. This is foundational infrastructure for HF scalping strategies that use market sentiment signals.

## Files Changed

### New Files
- `migrations/012_add_open_interest_and_lsr.sql` - PostgreSQL migration adding `open_interest` and `long_short_ratio` tables with composite primary keys and lookup indexes
- `scripts/cache-oi-data.ts` - CLI script for caching OI/LSR data, analogous to `cache-funding-rates.ts`

### Modified Files
- `src/core/types.ts` - Added `OpenInterestRecord` and `LongShortRatioRecord` interfaces
- `src/data/db.ts` - Added 6 new DB functions: `saveOpenInterest`, `getOpenInterest`, `getOpenInterestDateRange`, `saveLongShortRatio`, `getLongShortRatio`, `getLongShortRatioDateRange`
- `src/data/providers/bybit.ts` - Added `fetchOpenInterestHistory` and `fetchLongShortRatioHistory` methods to `BybitProvider`

## Schema

```sql
CREATE TABLE open_interest (
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  open_interest_amount DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (exchange, symbol, timestamp)
);

CREATE TABLE long_short_ratio (
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  long_ratio DOUBLE PRECISION NOT NULL,
  short_ratio DOUBLE PRECISION NOT NULL,
  long_short_ratio DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (exchange, symbol, timestamp)
);
```

## Cache Script Usage

```bash
# Cache OI at 5m resolution for specific symbols
npx tsx scripts/cache-oi-data.ts --exchange=bybit --symbols=BTC/USDT:USDT,ETH/USDT:USDT --from=2024-01-01 --timeframe=5m

# Cache OI for all symbols at 1h
npx tsx scripts/cache-oi-data.ts --exchange=bybit --symbols=ALL --from=2024-01-01 --timeframe=1h

# Cache Long/Short Ratio (always 1h on Bybit)
npx tsx scripts/cache-oi-data.ts --exchange=bybit --symbols=BTC/USDT:USDT --from=2024-01-01 --type=lsr
```

## Notes
- OI supports timeframes: `5m`, `15m`, `1h`, `4h`, `1d`
- LSR is fixed at `1h` granularity (Bybit limitation)
- Smart incremental caching: only fetches missing date ranges if data is partially cached
- Uses ON CONFLICT DO UPDATE (upsert) for all inserts
