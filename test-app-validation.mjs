// Test script to validate the backtesting application
import http from 'http';

const API_BASE = 'http://localhost:3000';
const FRONTEND_BASE = 'http://localhost:5173';

console.log('='.repeat(60));
console.log('BACKTESTING APPLICATION VALIDATION TEST');
console.log('='.repeat(60));
console.log();

// Helper to make HTTP requests
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        } else {
          reject({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  const results = { passed: 0, failed: 0, tests: [] };

  // Test 1: API Server - /api/strategies
  try {
    console.log('Test 1: GET /api/strategies');
    const res = await makeRequest(API_BASE + '/api/strategies');
    const strategies = JSON.parse(res.data);
    
    if (Array.isArray(strategies) && strategies.length > 0) {
      console.log('  ✓ PASS - Found ' + strategies.length + ' strategies');
      console.log('  - First strategy: ' + strategies[0].name);
      results.passed++;
    } else {
      console.log('  ✗ FAIL - Invalid response format');
      results.failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL - Error: ' + (error.status || error.message));
    results.failed++;
  }
  console.log();

  // Test 2: API Server - /api/backtest/history
  try {
    console.log('Test 2: GET /api/backtest/history (500 Error Fix)');
    const res = await makeRequest(API_BASE + '/api/backtest/history');
    const history = JSON.parse(res.data);
    
    if (Array.isArray(history)) {
      console.log('  ✓ PASS - No 500 error! Found ' + history.length + ' backtest records');
      if (history.length > 0) {
        console.log('  - First record: ' + history[0].strategyName + ' on ' + history[0].symbol);
        console.log('  - Return: ' + history[0].totalReturnPercent.toFixed(2) + '%');
      }
      results.passed++;
    } else {
      console.log('  ✗ FAIL - Invalid response format');
      results.failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL - Error: ' + (error.status || error.message));
    if (error.status === 500) {
      console.log('  ⚠ WARNING: Still getting 500 Internal Server Error!');
    }
    results.failed++;
  }
  console.log();

  // Test 3: Frontend Server
  try {
    console.log('Test 3: Frontend Server (GET /)');
    const res = await makeRequest(FRONTEND_BASE);
    
    if (res.data.includes('Backtesting Platform') && res.data.includes('<div id="root">')) {
      console.log('  ✓ PASS - Frontend HTML loads correctly');
      console.log('  - Title found: "Backtesting Platform"');
      console.log('  - React root div found');
      results.passed++;
    } else {
      console.log('  ✗ FAIL - Invalid HTML structure');
      results.failed++;
    }
  } catch (error) {
    console.log('  ✗ FAIL - Error: ' + (error.status || error.message));
    results.failed++;
  }
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log('Total Tests: ' + (results.passed + results.failed));
  console.log('Passed: ' + results.passed + ' ✓');
  console.log('Failed: ' + results.failed + ' ✗');
  console.log();

  if (results.failed === 0) {
    console.log('🎉 ALL TESTS PASSED! The 500 error fix is working correctly.');
    console.log();
    console.log('Key Findings:');
    console.log('- /api/strategies endpoint: Working');
    console.log('- /api/backtest/history endpoint: Fixed (no more 500 errors)');
    console.log('- Frontend: Loading correctly');
  } else {
    console.log('❌ SOME TESTS FAILED - Review errors above');
  }
  console.log('='.repeat(60));

  process.exit(results.failed === 0 ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
