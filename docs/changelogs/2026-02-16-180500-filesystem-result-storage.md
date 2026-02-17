# Filesystem Result Storage for All Backtests

**Date**: 2026-02-16 18:05
**Author**: dev-team

## Summary

Added automatic filesystem storage for all backtest results. Every backtest (single, pairs, and scanner) now saves its full result as a JSON file to the `results/` directory with a standardized naming convention. Results are independent of database storage and always succeed even when DB save is disabled.

## Changed

- **`src/core/engine.ts`**: Integrated filesystem result saving after each single-asset backtest completion. Results save independently of DB storage settings.
- **`src/core/pairs-engine.ts`**: Integrated filesystem result saving for pairs strategy backtests using the same storage module.
- **`src/api/routes/scan.ts`**: Collects individual market results during scanner execution and saves a comprehensive summary file after scan completes.

## Added

- **`src/core/result-storage.ts`**: New module handling all result file operations
  - `saveResultToFile(result, strategyName)` - Saves individual backtest results as pretty-printed JSON
  - `saveScanResultsToFile(scanResults, strategyName)` - Saves scanner summary with all market results and aggregated metrics
  - Automatic path creation: `results/{strategy-name}/{YYYY-MM-DD-HHmmss}-{symbol}.json`
  - Scanner files: `results/{strategy-name}/scan-{YYYY-MM-DD-HHmmss}.json`
  - Filename sanitization for safe filesystem characters
  - Error handling that logs but doesn't crash backtests

- **`results/.gitkeep`**: Placeholder file for git tracking
- **`results/README.md`**: Documentation for results directory structure and reproducibility

## Fixed

- Scanner results were previously ephemeral (only in memory during API response). Now all scan results persist to filesystem for reproducibility and analysis.

## Files Modified

- `src/core/engine.ts` - Auto-save individual results after backtest
- `src/core/pairs-engine.ts` - Auto-save pairs results after backtest
- `src/api/routes/scan.ts` - Collect and save scanner results summary

## Files Added

- `src/core/result-storage.ts` - Result file storage implementation
- `results/.gitkeep` - Git tracking placeholder
- `results/README.md` - Directory documentation

## Context

Filesystem storage provides several benefits:
1. **Reproducibility**: All backtest results persist independently of database operations
2. **Version Control**: Results can be committed for historical tracking
3. **Decoupled from DB**: Results save even when `saveResults: false` for scanner performance
4. **Audit Trail**: Complete record of all backtests run through the system
5. **Portability**: Easy export and sharing of specific backtest results

Each result file is self-contained with full configuration, metrics, trade details, equity curve, and metadata timestamp for complete result reconstruction.
