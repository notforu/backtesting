---
name: perf
description: Performance analysis and optimization. Identifies bottlenecks, suggests improvements, and benchmarks changes.
---

Performance analysis for: `$ARGUMENTS`

If no specific target given, analyze the overall application.

## Analysis steps:

### 1. Identify hot paths
- Find the most frequently executed code paths
- Look for code that runs on every request/render/event
- Check for expensive operations in loops

### 2. Common performance issues

**Backend:**
- N+1 database queries
- Missing database indexes (check query patterns vs schema)
- Synchronous operations that could be async
- Missing caching for repeated computations
- Large payloads without pagination
- Memory leaks (unclosed connections, growing arrays, event listener buildup)

**Frontend:**
- Unnecessary re-renders (missing memoization)
- Large bundle sizes (check for tree-shaking issues)
- Unoptimized images or assets
- Layout thrashing (DOM reads/writes interleaved)
- Missing virtualization for long lists

**General:**
- Inefficient algorithms (O(n^2) that could be O(n))
- Redundant computations
- Missing debounce/throttle on frequent events
- Excessive logging in hot paths

### 3. Suggest optimizations
For each finding:
- Describe the issue and its impact
- Provide a specific code-level fix
- Estimate the improvement (if measurable)
- Note any trade-offs

## Output format:
Rank findings by estimated impact (high → low).

```
[IMPACT: HIGH/MEDIUM/LOW] Category - file:line
  Issue: What's slow and why
  Fix: Specific code change
  Trade-off: Any downsides to the optimization
```
