# Polymarket Historical Data: Research Report

**Date**: 2026-02-16
**Author**: quant-lead agent
**Purpose**: Comprehensive analysis of options for obtaining more than 30 days of Polymarket historical data

---

## Table of Contents

1. [Current Limitation](#1-current-limitation)
2. [CLOB API -- Windowed Requests (Best Quick Win)](#2-clob-api----windowed-requests-best-quick-win)
3. [CLOB API -- Higher Fidelity for Longer History](#3-clob-api----higher-fidelity-for-longer-history)
4. [Polymarket Data API -- /trades Endpoint](#4-polymarket-data-api----trades-endpoint)
5. [Goldsky Subgraphs (Free, On-Chain)](#5-goldsky-subgraphs-free-on-chain)
6. [The Graph Protocol](#6-the-graph-protocol)
7. [Bitquery GraphQL API](#7-bitquery-graphql-api)
8. [FinFeedAPI (OHLCV-Native)](#8-finfeedapi-ohlcv-native)
9. [PredictionData.dev (Tick-Level Archive)](#9-predictiondatadev-tick-level-archive)
10. [PredictAPI.dev](#10-predictapidev)
11. [poly_data (Open-Source Scraper)](#11-poly_data-open-source-scraper)
12. [PolymarketDataLoader (Open-Source Pipeline)](#12-polymarketdataloader-open-source-pipeline)
13. [Dune Analytics](#13-dune-analytics)
14. [Kaggle Datasets](#14-kaggle-datasets)
15. [Academic Datasets](#15-academic-datasets)
16. [Polymarket Premium API Tier](#16-polymarket-premium-api-tier)
17. [Summary Comparison Table](#17-summary-comparison-table)
18. [Recommended Implementation Plan](#18-recommended-implementation-plan)

---

## 1. Current Limitation

Our current `PolymarketProvider` at `/workspace/src/data/providers/polymarket.ts` calls:

```
GET https://clob.polymarket.com/prices-history?market={tokenId}&interval=all&fidelity={60|900}
```

This returns approximately 740 data points maximum regardless of fidelity:
- `fidelity=60` (1-minute resolution): ~740 pts over ~31 days -- good for hourly candles
- `fidelity=900` (15-minute resolution): ~650 pts over ~13 months -- too sparse for hourly
- Resolved/closed markets return empty `history` arrays (data is purged)

**Root cause**: The `interval=all` parameter (aliased as `max`) returns the entire available history but caps at ~740 data points. The API does not document this limit, but it is consistently observed.

---

## 2. CLOB API -- Windowed Requests (Best Quick Win)

### Discovery

GitHub issue #216 on `py-clob-client` revealed a critical workaround: instead of using `interval=all` (which caps at ~740 points), use explicit `startTs` and `endTs` parameters in windowed chunks. The `startTs`/`endTs` parameters are **mutually exclusive** with `interval`.

### How It Works

The API apparently returns up to ~740 data points **per request window**. By making multiple requests with different time windows, you can stitch together much longer histories:

```
Window 1: startTs=T0, endTs=T0+30d, fidelity=60   -> ~740 pts (31 days)
Window 2: startTs=T0+30d, endTs=T0+60d, fidelity=60 -> ~740 pts (31 days)
Window 3: startTs=T0+60d, endTs=T0+90d, fidelity=60 -> ~740 pts (31 days)
...
```

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Back to market creation date (months to years) |
| **Granularity** | ~1 point per minute (fidelity=60) aggregated to any candle size |
| **Cost** | Free |
| **Rate limits** | Undocumented but conservative (our 15/min should work) |
| **Integration effort** | LOW -- modify existing `fetchCandles()` to loop over windows |

### Caveats

- **Resolved markets**: The CLOB API returns empty data for resolved/closed markets. Only active markets have history. This is a hard limitation.
- **Granularity for resolved markets**: Even when data was available, resolved markets only returned 12h+ granularity.
- **No volume data**: Still only `{t, p}` pairs; no real volume information.
- **Needs testing**: The exact behavior of windowed requests needs empirical verification (how many points per window, does it work for all markets, etc.)

### Implementation Approach

```typescript
async fetchCandles(symbol, timeframe, start, end) {
  const WINDOW_SIZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const allPoints: Array<{t: number; p: number}> = [];

  let windowStart = Math.floor(start.getTime() / 1000);
  const endTs = Math.floor(end.getTime() / 1000);

  while (windowStart < endTs) {
    const windowEnd = Math.min(windowStart + WINDOW_SIZE_MS / 1000, endTs);
    const url = `${clobApiBase}/prices-history?market=${tokenId}&startTs=${windowStart}&endTs=${windowEnd}&fidelity=60`;
    const data = await fetch(url);
    // Append points, deduplicate at boundaries
    allPoints.push(...data.history);
    windowStart = windowEnd;
  }

  return convertPricePointsToCandles(allPoints, timeframe, start, end);
}
```

---

## 3. CLOB API -- Higher Fidelity for Longer History

### How It Works

Using larger `fidelity` values (e.g., 1440 for daily) with `interval=all` gives fewer but more spread-out data points:

| Fidelity | Resolution | Approx Coverage | Points |
|----------|-----------|-----------------|--------|
| 60 | 1 min | ~31 days | ~740 |
| 900 | 15 min | ~13 months | ~650 |
| 1440 | 1 day (24h) | ~2 years (estimated) | ~730 |
| 3600 | 2.5 days | ~5 years (estimated) | ~730 |

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Months to years depending on fidelity |
| **Granularity** | Daily or coarser only |
| **Cost** | Free |
| **Integration effort** | TRIVIAL -- already partially implemented |

### Caveats

- Very sparse for hourly candles -- massive forward-fill required
- Only useful for daily+ timeframe strategies
- Same resolved-market limitation applies

---

## 4. Polymarket Data API -- /trades Endpoint

### Discovery

The Data API at `https://data-api.polymarket.com/trades` provides individual trade records with pagination.

### How It Works

```
GET https://data-api.polymarket.com/trades?market={conditionId}&limit=500&offset=0
```

Returns individual trades with: side (BUY/SELL), asset, size, price, timestamp, transaction hash.

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Full history of the market |
| **Granularity** | Tick-level (individual trades) |
| **Cost** | Free |
| **Rate limits** | ~100 requests/minute |
| **Max results** | limit=500 per request, offset max ~10,000 in practice |
| **Integration effort** | MEDIUM -- new endpoint, need to aggregate trades into candles |

### Caveats

- **Pagination limits**: Effective cap around offset=1,000 with limit=500 = ~1,500 trades retrievable. For active markets with millions of trades, this is insufficient.
- **Filtering workaround**: Use `filterType=CASH` and `filterAmount` to filter for larger trades, but this misses small trades that contribute to price discovery.
- **Aggregation needed**: Must compute OHLCV candles from individual trades.
- **No straightforward way to get ALL trades** for high-volume markets.

---

## 5. Goldsky Subgraphs (Free, On-Chain)

### Discovery

Polymarket hosts 5 free subgraphs on Goldsky with no authentication required. The most relevant for historical data is the **Activity Subgraph** and **Orders Subgraph**.

### Endpoints

| Subgraph | URL | Purpose |
|----------|-----|---------|
| **Orders** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn` | Orderbook analytics, market microstructure |
| **Activity** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn` | Trades, splits, merges, redemptions |
| **Positions** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn` | User positions with avg price and P&L |
| **Open Interest** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/oi-subgraph/0.0.6/gn` | Market and global OI |
| **PnL** | `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn` | Profit/loss calculations |

### Example Query (Activity Subgraph)

```graphql
{
  trades(
    first: 1000,
    orderBy: timestamp,
    orderDirection: asc,
    where: { market: "0x..." }
  ) {
    id
    market { question }
    side
    price
    size
    timestamp
  }
}
```

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Full on-chain history (back to market creation) |
| **Granularity** | Tick-level (individual on-chain events) |
| **Cost** | Free (fair use policy) |
| **Authentication** | None required |
| **Rate limits** | Fair use (undocumented) |
| **Max per query** | 1000 entities (standard GraphQL pagination with `skip`) |
| **Integration effort** | HIGH -- new GraphQL client, trade aggregation, token ID mapping |

### Caveats

- **GraphQL pagination**: Must paginate through results (1000 at a time) using `skip` or `id_gt` cursor patterns.
- **Slow for large datasets**: Fetching millions of trades for popular markets is slow.
- **Price calculation**: Must compute price from orderFilled events (USDC paid / tokens received).
- **Schema complexity**: Need to map between condition IDs, token IDs, and market slugs.
- **Data quality**: On-chain data includes all transactions, not just CLOB matches.

---

## 6. The Graph Protocol

### How It Works

The same Polymarket subgraph is available on The Graph Network with the subgraph ID: `Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp`.

```
https://gateway.thegraph.com/api/{api-key}/subgraphs/id/Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp
```

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Full on-chain history |
| **Granularity** | Tick-level |
| **Cost** | Free for first 100K queries/month, then $4/100K queries |
| **Authentication** | API key required (free signup) |
| **Integration effort** | HIGH (same as Goldsky, requires API key management) |

### Versus Goldsky

The Graph requires authentication and has explicit pricing, while Goldsky is currently free without auth. The underlying data is the same. **Goldsky is preferred** for our use case.

---

## 7. Bitquery GraphQL API

### How It Works

Bitquery indexes Polygon blockchain data and exposes it via GraphQL. You can query `OrderFilled` events from the Polymarket CTF Exchange contracts:
- Current contract: `0xC5d563A36AE78145C45a50134d48A1215220f80a`
- Legacy contract: `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`

Price calculation: `Price = USDC paid / tokens received` from OrderFilled event arguments.

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Full blockchain history |
| **Granularity** | Tick-level (individual fills) |
| **Cost** | Free tier available (limits unclear) |
| **Authentication** | API key required |
| **Integration effort** | HIGH -- GraphQL, contract-level parsing, price computation |

---

## 8. FinFeedAPI (OHLCV-Native)

### Discovery

FinFeedAPI (by the CoinAPI team) provides **OHLCV candles natively** for prediction markets including Polymarket. This is the only third-party API found that directly returns candle data in standard OHLCV format.

### Endpoint

```
GET https://api.prediction-markets.finfeedapi.com/v1/ohlcv/polymarket/{symbol_id}/history?period_id=1HRS
```

Supported periods: `1SEC`, `1MIN`, `5MIN`, `15MIN`, `1HRS`, `4HRS`, `1DAY`, and more.

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Unknown (likely full history, needs verification) |
| **Granularity** | 1 second to daily+ |
| **Cost** | Free API key available, paid tiers for higher limits |
| **Format** | Standard OHLCV JSON |
| **Integration effort** | LOW -- direct OHLCV, minimal transformation needed |
| **Rate limits** | Unknown |
| **Exchanges** | Polymarket, Kalshi, Myriad, Manifold |

### Why This Is Attractive

This is the **closest drop-in replacement** for our current CLOB API approach. It returns OHLCV directly, supports multiple intervals, and covers Polymarket. The integration effort would be minimal compared to reconstructing candles from raw trades.

### Caveats

- Relatively new service; reliability and data completeness unknown
- Free tier limits unclear
- Need to verify symbol ID format and mapping
- No volume data guarantee (may use same {t,p} under the hood)

---

## 9. PredictionData.dev (Tick-Level Archive)

### Overview

PredictionData.dev is a specialized prediction market data vendor offering the most comprehensive historical archive found during this research.

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Up to 3 years |
| **Granularity** | Tick-level (L2 orderbook, fills, trades) |
| **Data volume** | 10B+ tick-level updates, 300K+ markets |
| **Cost** | Solo: $450/month, Full Access: $1,250/month, Enterprise: custom |
| **Format** | Gzip-compressed CSV, Parquet (Enterprise) |
| **Integration effort** | MEDIUM -- CSV parsing, trade-to-candle aggregation |

### Endpoint Pattern

```
GET /polymarket/onchain/fills/{market-slug}/{outcome}/{date}.csv.gz?slug=true&apikey=YOUR_KEY
```

### Caveats

- **Expensive**: $450/month minimum is steep for a backtesting project
- No OHLCV aggregation -- raw tick data only, must aggregate to candles
- Overkill for our needs (we just want hourly/daily candles)

---

## 10. PredictAPI.dev

### Overview

Built for algorithmic traders, providing bid/ask/spread/volume updated every second.

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Up to 1 year of tick-level data |
| **Granularity** | Per-second updates |
| **Cost** | Unknown (likely paid) |
| **Format** | JSON and CSV |
| **Integration effort** | MEDIUM |

---

## 11. poly_data (Open-Source Scraper)

### Overview

Open-source Python project by `warproxxx` that fetches all Polymarket data via three stages:
1. Market metadata from Gamma API (batch of 500)
2. OrderFilled events from Goldsky subgraph API (GraphQL)
3. Trade processing (price = USDC/tokens, direction inference)

### Repository

https://github.com/warproxxx/poly_data

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Complete (all on-chain history) |
| **Granularity** | Tick-level (individual fills) |
| **Cost** | Free (open source, MIT-like) |
| **Initial setup** | 2+ days for full data collection (or download snapshot) |
| **Output** | CSV files: markets.csv, orderFilled.csv, trades.csv |
| **Integration effort** | HIGH -- Python tool, need to run externally, parse CSVs, aggregate to candles |

### How Price Is Calculated

```
Asset ID "0" = USDC
Price = USDC amount / outcome token amount
Amounts normalized by dividing by 10^6
```

### Caveats

- Python project (our system is TypeScript)
- Requires running as separate pipeline
- Full collection takes 2+ days without snapshot
- Need to convert raw trades to OHLCV candles

---

## 12. PolymarketDataLoader (Open-Source Pipeline)

### Overview

Production-ready data pipeline by `yvenotsaint`, inspired by poly_data. Supports both historical collection and real-time WebSocket streaming.

### Repository

https://github.com/yvenotsaint/PolymarketDataLoader

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Complete |
| **Granularity** | Tick-level |
| **Cost** | Free (open source) |
| **Real-time** | Yes (WebSocket) |
| **Integration effort** | HIGH |

---

## 13. Dune Analytics

### Overview

Dune Analytics has SQL queries that compute Polymarket historical prices from on-chain data. Multiple dashboards exist:
- `dune.com/rchen8/polymarket` -- Main Polymarket dashboard
- `dune.com/queries/4230507` -- Historical Market Data query
- `dune.com/queries/4282262` -- Historical Market Data 3

### How It Works

Dune queries on-chain Polygon data to calculate historical "Yes" token prices at specific intervals (4h, 12h, 1d, 1w, 1m before resolution). These are SQL queries running against indexed blockchain data.

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Complete on-chain history |
| **Granularity** | Configurable via SQL (but computationally expensive for fine resolution) |
| **Cost** | Free for 100 queries/month, paid for more |
| **Format** | CSV export from dashboard, or API access |
| **Integration effort** | HIGH -- need Dune account, SQL customization, API integration |

### Caveats

- Not designed for programmatic bulk data access
- SQL queries can be slow for fine-grained resolution across many markets
- Best for ad-hoc analysis, not production data pipeline
- May require Dune API (paid) for programmatic access

---

## 14. Kaggle Datasets

### Available Datasets

| Dataset | Author | Coverage | Type |
|---------|--------|----------|------|
| Full market data | sandeepkumarfromin | Jul 2022 - Dec 2025 | Metadata snapshot (NOT time series) |
| Prediction Markets Dataset | ismetsemedov | Jul 2022 - Dec 2025 | Metadata + metrics (43K events, 100K markets) |
| 2024 US Election State Data | pbizil | 2024 election period | Election-specific |
| Bitcoin 15min Up or Down | hugobde | Limited | Bitcoin-specific |
| 2024 US Senate Races | deluxe1103 | 2024 | Daily prices, election-specific |

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Up to 2.3 years of metadata |
| **Granularity** | Event/market level snapshots, NOT time series |
| **Cost** | Free |
| **Format** | CSV |
| **Integration effort** | N/A -- not useful for backtesting (no OHLCV) |

### Verdict

The Kaggle datasets contain **market metadata and aggregate statistics, not price time series data**. They are useful for finding interesting markets to backtest but cannot serve as a data source for candle generation.

---

## 15. Academic Datasets

### Available Papers

1. **"Exploring Decentralized Prediction Markets: Accuracy, Skill, and Bias on Polymarket"** (SSRN, Dec 2025)
   - Authors: Reichenbach, Walther
   - Dataset: 124 million trades
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5910522
   - Data availability: Check paper for download/request instructions

2. **"Price Discovery and Trading in Modern Prediction Markets"** (SSRN)
   - Authors: Ng, Peng, Tao, Zhou
   - Covers Polymarket, Kalshi, PredictIt during 2024 election
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5331995

3. **"Beyond the Polls"** (MDPI Futures Internet)
   - Cross-correlation analysis of Polymarket data
   - 11 million on-chain transactions (Sept-Nov 2024)

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | Full market history (up to 2+ years) |
| **Granularity** | Tick-level trades |
| **Cost** | Free (academic) but may require author contact |
| **Integration effort** | HIGH -- custom format, one-time snapshots |

---

## 16. Polymarket Premium API Tier

### Overview

Polymarket offers premium API access starting at $99/month that unlocks:
- WebSocket feeds
- **Historical depth beyond 30 days**
- Priority support

Enterprise plans at $500+/month include dedicated nodes.

### Key Details

| Attribute | Value |
|-----------|-------|
| **Historical depth** | "Beyond 30 days" (exact limit unknown) |
| **Granularity** | Same as free tier endpoints |
| **Cost** | $99/month (premium), $500+/month (enterprise) |
| **Integration effort** | LOW -- same API, just more data |

### Caveats

- Exact capabilities of the premium tier are not well-documented publicly
- Unclear if it solves the resolved-market data purge issue
- Cost adds up for a backtesting-only use case

---

## 17. Summary Comparison Table

| Source | History Depth | Granularity | Cost | OHLCV? | Resolved Markets? | Integration |
|--------|--------------|-------------|------|--------|-------------------|-------------|
| **CLOB Windowed** | Market lifetime | ~1min | Free | No (t,p) | NO | LOW |
| **CLOB High Fidelity** | Years | Daily+ | Free | No (t,p) | NO | TRIVIAL |
| **Data API /trades** | Full | Tick | Free | No | Partial | MEDIUM |
| **Goldsky Subgraphs** | Full on-chain | Tick | Free | No | YES | HIGH |
| **The Graph** | Full on-chain | Tick | Free/100K | No | YES | HIGH |
| **Bitquery** | Full on-chain | Tick | Free tier | No | YES | HIGH |
| **FinFeedAPI** | Unknown | 1sec-1day | Free tier | **YES** | Unknown | **LOW** |
| **PredictionData.dev** | 3 years | Tick/L2 | $450+/mo | No | YES | MEDIUM |
| **PredictAPI.dev** | 1 year | Per-second | Paid | No | Unknown | MEDIUM |
| **poly_data** | Full | Tick | Free | No | YES | HIGH |
| **Dune Analytics** | Full | Configurable | Free/100q | No | YES | HIGH |
| **Kaggle** | 2.3 years | Snapshot | Free | No | N/A | N/A |
| **Academic** | Full | Tick | Free/contact | No | YES | HIGH |
| **PM Premium** | "Beyond 30d" | Same API | $99+/mo | No (t,p) | Unknown | LOW |

---

## 18. Recommended Implementation Plan

### Phase 1: Quick Win -- CLOB Windowed Requests (Priority: HIGH)

**Effort**: 2-4 hours
**Expected improvement**: From ~31 days to full market lifetime at hourly resolution
**Limitation**: Active markets only

Modify `PolymarketProvider.fetchCandles()` to:
1. Use `startTs`/`endTs` instead of `interval=all`
2. Loop over 30-day windows from `start` to `end`
3. Deduplicate points at window boundaries
4. Respect rate limits between requests
5. Cache fetched data in SQLite to avoid re-fetching

**Risks**: Needs empirical testing. The ~740 point cap per window is assumed but not documented. Could fail for very old markets or if the API throttles.

### Phase 2: FinFeedAPI Integration (Priority: MEDIUM)

**Effort**: 4-8 hours
**Expected improvement**: Direct OHLCV data, multiple intervals, potentially full history

Add a new `FinFeedProvider` data provider:
1. Register API key (free tier)
2. Map our `PM:slug` symbols to FinFeedAPI symbol IDs
3. Fetch OHLCV candles directly (no aggregation needed)
4. Support multiple intervals natively
5. Cache in SQLite alongside CCXT data

**Risks**: New service, reliability unknown. Free tier limits unclear.

### Phase 3: Goldsky Subgraph for Resolved Markets (Priority: LOW)

**Effort**: 2-3 days
**Expected improvement**: Access to resolved market history (which CLOB API purges)

Build a Goldsky data fetcher:
1. GraphQL client for Activity Subgraph
2. Fetch OrderFilled events with pagination
3. Compute prices: `USDC / tokens`
4. Map token IDs to market slugs
5. Aggregate individual fills into OHLCV candles
6. Cache results in SQLite

**Risks**: High complexity, slow for large markets, GraphQL pagination quirks.

### Phase 4: Continuous Data Collection (Priority: LOW)

**Effort**: 1-2 days
**Expected improvement**: Build up historical archive over time

Set up a background scraper/scheduler that:
1. Periodically fetches price data for watched markets
2. Stores in SQLite with proper deduplication
3. Over weeks/months, builds up a deep local archive
4. Eliminates dependency on third-party historical depth

---

## Key Insight: The Resolved Market Problem

The single biggest limitation is that **Polymarket purges CLOB price history for resolved markets**. This means:

- You cannot backtest strategies on markets that have already ended
- Election markets, which had the most volume and interest, are inaccessible via CLOB API
- Only on-chain sources (Goldsky, The Graph, Bitquery, poly_data) preserve resolved market data

For a backtesting platform focused on **active** markets with ongoing price action, the CLOB windowed approach (Phase 1) solves the depth problem. For analyzing **resolved** markets (valuable for strategy validation), Goldsky (Phase 3) is the only free option.

---

## References

- [Polymarket CLOB API Timeseries Documentation](https://docs.polymarket.com/developers/CLOB/timeseries)
- [Polymarket API Reference - Price History](https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token)
- [py-clob-client Issue #216 - Resolved market granularity](https://github.com/Polymarket/py-clob-client/issues/216)
- [py-clob-client Issue #189 - Blank responses for closed contracts](https://github.com/Polymarket/py-clob-client/issues/189)
- [Polymarket Subgraph Overview](https://docs.polymarket.com/developers/subgraph/overview)
- [Querying Polymarket with The Graph](https://thegraph.com/docs/en/subgraphs/guides/polymarket/)
- [Goldsky Polymarket Integration](https://goldsky.com/chains/polymarket)
- [Polymarket GraphQL Subgraph Guide - PolyTrack](https://www.polytrackhq.app/blog/polymarket-graphql-subgraph-guide)
- [poly_data GitHub Repository](https://github.com/warproxxx/poly_data)
- [PolymarketDataLoader GitHub Repository](https://github.com/yvenotsaint/PolymarketDataLoader)
- [Polymarket Subgraph GitHub Repository](https://github.com/Polymarket/polymarket-subgraph)
- [Bitquery Polymarket API](https://docs.bitquery.io/docs/examples/polymarket-api/)
- [FinFeedAPI Prediction Markets API](https://www.finfeedapi.com/products/prediction-markets-api)
- [PredictionData.dev](https://predictiondata.dev)
- [PredictAPI.dev](https://predictapi.dev/)
- [EntityML Polymarket Data API](https://entityml.com/)
- [Polymarket Data API Docs (Community Gist)](https://gist.github.com/shaunlebron/0dd3338f7dea06b8e9f8724981bb13bf)
- [Polymarket API Architecture (Medium)](https://medium.com/@gwrx2005/the-polymarket-api-architecture-endpoints-and-use-cases-f1d88fa6c1bf)
- [Kaggle: Polymarket Prediction Markets Dataset](https://www.kaggle.com/datasets/ismetsemedov/polymarket-prediction-markets)
- [SSRN: Accuracy, Skill, and Bias on Polymarket (124M trades)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5910522)
- [SSRN: Price Discovery in Modern Prediction Markets](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5331995)
- [Dune: Polymarket Historical Market Data](https://dune.com/queries/4230507)
