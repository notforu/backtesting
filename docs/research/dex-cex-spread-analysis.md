# DEX-CEX Spread Analysis

**Generated:** 2026-02-18 07:53:50

## Summary

Analyzed 4 DEX-CEX pairs across multiple chains.
Looking for exploitable price discrepancies between decentralized and centralized exchanges.

## Spread Statistics by Pool

| Pool | Aligned Candles | Mean Spread % | Median % | Max % | >0.1% | >0.3% | >0.5% | >1.0% | Avg Reversion (bars) |
|------|----------------|---------------|----------|-------|-------|-------|-------|-------|---------------------|
| Ethereum Uniswap V3 ETH/USDC | 2208 | 0.1352 | 0.1245 | 0.64 | 58.6% | 5.6% | 0.1% | 0.0% | 2.4 |
| Arbitrum Uniswap V3 ETH/USDC | 2208 | 0.0773 | 0.0604 | 0.87 | 26.9% | 1.4% | 0.2% | 0.0% | 1.7 |
| Base Aerodrome ETH/USDC | 2208 | 0.0660 | 0.0515 | 0.87 | 20.7% | 0.9% | 0.1% | 0.0% | 1.8 |
| Solana Raydium SOL/USDC | 2208 | 0.1257 | 0.1124 | 1.01 | 54.9% | 3.5% | 0.1% | 0.0% | 2.4 |

## Interpretation

### Minimum Profitable Spread per Chain

To profitably arbitrage DEX-CEX, the spread must exceed:
- **Ethereum**: ~0.3-0.5% (high gas fees, ~$5-50 per swap)
- **Arbitrum**: ~0.1-0.2% (low gas, ~$0.10-0.50 per swap)
- **Base**: ~0.1-0.2% (low gas, similar to Arbitrum)
- **Solana**: ~0.05-0.1% (very low fees, ~$0.01 per swap)

### Key Findings

**Ethereum Uniswap V3 ETH/USDC**: Potentially viable. Spread >0.3% occurs 5.6% of the time. Mean reversion takes 2.4 bars.
**Arbitrum Uniswap V3 ETH/USDC**: Not viable. Spread rarely exceeds profitable threshold. Mean spread: 0.0773%
**Base Aerodrome ETH/USDC**: Not viable. Spread rarely exceeds profitable threshold. Mean spread: 0.0660%
**Solana Raydium SOL/USDC**: Not viable. Spread rarely exceeds profitable threshold. Mean spread: 0.1257%

## Conclusion

Some DEX-CEX pairs show exploitable spread patterns. Further investigation with higher frequency data and gas cost modeling recommended.
