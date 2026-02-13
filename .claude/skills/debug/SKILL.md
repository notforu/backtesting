---
name: debug
description: Structured debugging workflow to find and fix bugs. Use when something is broken, tests fail, or behavior is unexpected.
---

Debug: `$ARGUMENTS`

## Debugging workflow:

### 1. Reproduce
- Understand the expected vs actual behavior
- Identify the minimal reproduction steps
- Check error messages, stack traces, logs

### 2. Isolate
- Narrow down which file/function/line causes the issue
- Use grep to find related code paths
- Check recent git changes that might have introduced the bug: `git log --oneline -20` and `git diff HEAD~5`

### 3. Diagnose
- Read the relevant code carefully
- Trace the execution flow mentally or with logging
- Check for common causes:
  - Null/undefined values
  - Async timing issues
  - Type mismatches
  - State mutation side effects
  - Import/export errors
  - Environment/config differences

### 4. Fix
- Make the minimal change needed to fix the root cause
- Do NOT fix symptoms - find and fix the actual root cause
- Ensure the fix doesn't break other functionality

### 5. Verify
- Run the specific failing test/scenario
- Run the full test suite
- Run type checking and linting
- Check for regressions in related functionality

## Rules:
- Always find root cause, not just suppress symptoms
- Add a test that would have caught this bug
- If the bug was caused by unclear code, refactor for clarity
- Document the fix in the commit message (what was wrong and why)
