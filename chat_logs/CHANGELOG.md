# Changelog

All significant changes to the backtesting platform are documented here. See individual files in `/docs/changelogs/` for detailed information on each change.

## 2026-02-23: Expanded FR-Spike Scan and Aggregations

**File**: `/docs/changelogs/2026-02-23-160000-expanded-fr-spike-scan-and-aggregations.md`

Expanded funding-rate-spike strategy from 26 to 74 Bybit symbols. Batch scanned 148 runs, discovered 10 new profitable assets, validated 4 with walk-forward testing. Created 6 aggregation portfolio configs with best Sharpe of 2.31. Results saved to database.

**Key achievements**:
- 74 Bybit symbols with 2-year candle + funding rate data
- 56/120 qualifying runs profitable (47%)
- Top performer: ADA 1h (Sharpe 1.56)
- 4 WF-validated assets (ETC 1h improved 86% OOS!)
- Production-ready portfolio configs saved to DB

---

## Previous Work

See `/docs/changelogs/` for all historical changes.
