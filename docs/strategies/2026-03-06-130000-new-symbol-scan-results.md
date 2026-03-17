# FR V2 New Symbol Scan (2026-03-06)

## Scan Parameters
- Strategy: funding-rate-spike-v2 (default params)
- Timeframe: 4h
- Period: 2024-01-01 to 2026-03-01
- Exchange: Bybit futures
- Total symbols scanned: 50

## Results (sorted by Sharpe, only symbols with actual trades shown)

| Rank | Symbol | Sharpe | Return% | MaxDD% | Trades | Verdict |
|------|--------|--------|---------|--------|--------|---------|
| 1 | TIA | 0.80 | 22.4% | 8.7% | 41 | MARGINAL |
| 2 | GRT | 0.77 | 12.1% | 9.3% | 24 | MARGINAL |
| 3 | APT | 0.71 | 16.3% | 8.0% | 39 | MARGINAL |
| 4 | JTO | 0.60 | 13.1% | 10.9% | 40 | MARGINAL |
| 5 | KAVA | 0.49 | 10.2% | 9.8% | 46 | SKIP |
| 6 | AVAX | 0.35 | 3.9% | 5.4% | 21 | SKIP |
| 7 | CHZ | 0.27 | 3.6% | 8.1% | 38 | SKIP |
| 8 | BLUR | 0.24 | 4.0% | 10.6% | 35 | SKIP |
| 9 | SUI | 0.20 | 3.5% | 19.9% | 51 | SKIP |
| 10 | CRV | 0.11 | 1.2% | 8.4% | 30 | SKIP |
| 11 | SOL | 0.10 | 0.8% | 8.7% | 35 | SKIP |
| 12 | DOT | 0.06 | 0.4% | 8.6% | 16 | SKIP |
| 13 | SNX | 0.00 | -0.5% | 9.3% | 26 | SKIP |
| 14 | THETA | 0.00 | -0.6% | 14.1% | 33 | SKIP |
| 15 | SEI | -0.00 | -1.0% | 9.8% | 31 | SKIP |
| 16 | ALGO | -0.05 | -0.8% | 5.4% | 15 | SKIP |
| 17 | JASMY | -0.07 | -3.0% | 24.6% | 24 | SKIP |
| 18 | PYTH | -0.15 | -7.2% | 21.2% | 45 | SKIP |
| 19 | SAND | -0.35 | -3.6% | 7.3% | 14 | SKIP |
| 20 | ADA | -0.35 | -4.4% | 6.9% | 22 | SKIP |
| 21 | LINK | -0.38 | -6.2% | 10.4% | 33 | SKIP |
| 22 | YFI | -0.42 | -4.8% | 12.9% | 29 | SKIP |
| 23 | GMX | -0.45 | -7.2% | 10.9% | 22 | SKIP |
| 24 | AAVE | -0.48 | -8.4% | 17.1% | 38 | SKIP |
| 25 | ZRX | -0.49 | -9.4% | 18.7% | 40 | SKIP |
| 26 | ORDI | -0.52 | -7.4% | 10.3% | 19 | SKIP |
| 27 | FIL | -0.63 | -5.4% | 7.1% | 11 | SKIP |
| 28 | UNI | -0.64 | -7.5% | 12.0% | 21 | SKIP |
| 29 | SUSHI | -0.75 | -9.1% | 14.3% | 24 | SKIP |
| 30 | ATOM | -0.77 | -9.5% | 10.9% | 29 | SKIP |
| 31 | DYDX | -0.92 | -15.5% | 18.3% | 36 | SKIP |
| 32 | INJ | -1.17 | -23.9% | 28.8% | 41 | SKIP |
| 33 | OP | -1.21 | -17.2% | 18.0% | 26 | SKIP |
| 34 | GALA | -1.47 | -16.5% | 17.3% | 19 | SKIP |
| 35 | AXS | -1.48 | -20.4% | 23.8% | 21 | SKIP |

Symbols with 0 trades or data errors not shown (PENDLE, MANTA, WLD, WIF, MEME, CAKE, STRK, FXS, MKR, BONK, PEPE, FET, RNDR, BONK).

## Conclusion

**No new symbols meet the walk-forward candidate threshold (Sharpe >= 1.0).**

The best 4 marginal candidates (TIA=0.80, GRT=0.77, APT=0.71, JTO=0.60) might improve with parameter optimization but are not strong enough to recommend for the portfolio without further validation.

### Key Observations
- FR V2 with default params has a narrow edge that works on specific mid/small-cap tokens
- Major assets (SOL, AVAX, LINK, DOT, ADA) show near-zero or negative Sharpe — funding rates are too efficient
- The already-validated symbols (ZEC, TRB, IOST, STG, LDO, DOGE etc.) appear to be the sweet spot
- Expanding beyond the current 10-symbol portfolio may require parameter tuning or strategy variant development

### Next Steps
- Consider WF-optimizing TIA, GRT, APT if desperate for more symbols
- Focus on validating the existing 10-symbol portfolio in paper trading first
- The current portfolio likely represents the viable FR V2 universe on Bybit
