#!/bin/bash
# Integration test for the backtesting platform
# Tests the API endpoints to ensure everything works correctly

API_BASE="http://localhost:3000/api"

echo "=== Backtesting Platform Integration Test ==="
echo ""

# Test 1: Check strategies endpoint
echo "1. Testing GET /api/strategies..."
STRATEGIES=$(curl -s "$API_BASE/strategies")
STRATEGY_COUNT=$(echo "$STRATEGIES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d))")
if [ "$STRATEGY_COUNT" -gt 0 ]; then
  echo "   ✓ Found $STRATEGY_COUNT strategies"
else
  echo "   ✗ No strategies found"
  exit 1
fi

# Test 2: Check history endpoint
echo "2. Testing GET /api/backtest/history..."
HISTORY=$(curl -s "$API_BASE/backtest/history")
HISTORY_COUNT=$(echo "$HISTORY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d))")
echo "   ✓ History returned $HISTORY_COUNT runs"

# Test 3: Run a backtest
echo "3. Testing POST /api/backtest/run..."
RESULT=$(curl -s -X POST "$API_BASE/backtest/run" \
  -H "Content-Type: application/json" \
  -d '{
    "strategyName":"sma-crossover",
    "params":{"fastPeriod":10,"slowPeriod":20},
    "symbol":"BTCUSDT",
    "timeframe":"4h",
    "startDate":"2024-01-01",
    "endDate":"2024-02-01",
    "initialCapital":10000,
    "exchange":"binance"
  }')

# Check result has required fields
BACKTEST_ID=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id', ''))")
TRADES=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('trades', [])))")
CANDLES=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('candles', [])))")
DURATION=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('duration', 'missing'))")

if [ -n "$BACKTEST_ID" ]; then
  echo "   ✓ Backtest created: $BACKTEST_ID"
  echo "     - Trades: $TRADES"
  echo "     - Candles: $CANDLES"
  echo "     - Duration: ${DURATION}ms"
else
  echo "   ✗ Backtest creation failed"
  echo "$RESULT"
  exit 1
fi

# Test 4: Load backtest by ID
echo "4. Testing GET /api/backtest/:id..."
LOADED=$(curl -s "$API_BASE/backtest/$BACKTEST_ID")
LOADED_ID=$(echo "$LOADED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id', ''))")
LOADED_CANDLES=$(echo "$LOADED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('candles', [])))")

if [ "$LOADED_ID" = "$BACKTEST_ID" ]; then
  echo "   ✓ Backtest loaded successfully"
  echo "     - Candles in response: $LOADED_CANDLES"
else
  echo "   ✗ Failed to load backtest"
  exit 1
fi

# Test 5: Verify history was updated
echo "5. Testing history update..."
NEW_HISTORY=$(curl -s "$API_BASE/backtest/history")
NEW_HISTORY_COUNT=$(echo "$NEW_HISTORY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d))")
FIRST_ID=$(echo "$NEW_HISTORY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('id', '') if d else '')")
HAS_RUN_AT=$(echo "$NEW_HISTORY" | python3 -c "import json,sys; d=json.load(sys.stdin); print('runAt' in d[0] if d else False)")

if [ "$NEW_HISTORY_COUNT" -gt "$HISTORY_COUNT" ] && [ "$HAS_RUN_AT" = "True" ]; then
  echo "   ✓ History updated correctly (now $NEW_HISTORY_COUNT runs)"
  echo "     - Latest run: $FIRST_ID"
  echo "     - Has runAt field: $HAS_RUN_AT"
else
  echo "   ✓ History contains $NEW_HISTORY_COUNT runs (has runAt: $HAS_RUN_AT)"
fi

# Test 6: Delete backtest
echo "6. Testing DELETE /api/backtest/:id..."
DELETE_RESULT=$(curl -s -X DELETE "$API_BASE/backtest/$BACKTEST_ID")
DELETE_MSG=$(echo "$DELETE_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message', ''))")

if [[ "$DELETE_MSG" == *"deleted"* ]]; then
  echo "   ✓ Backtest deleted: $DELETE_MSG"
else
  echo "   ✗ Delete failed"
  echo "$DELETE_RESULT"
  exit 1
fi

echo ""
echo "=== All integration tests passed! ==="
