---
name: refactor
description: Safe refactoring with impact analysis. Restructures code while ensuring nothing breaks.
disable-model-invocation: true
---

Refactor: `$ARGUMENTS`

## Workflow:

### 1. Understand current state
- Read the target code and all its callers/dependents
- Map the dependency graph (what uses this code?)
- Identify the public API surface that must be preserved
- Run existing tests to establish a baseline

### 2. Plan the refactoring
Present the plan to the user BEFORE making changes:
- What will change and why
- Files that will be modified
- Any breaking changes to public APIs
- Risk assessment (low/medium/high)

### 3. Execute incrementally
Make changes in small, verifiable steps:
- Rename/move one thing at a time
- Update all references after each change
- Run type checking after each step
- Keep the code compiling at every step

### 4. Verify
- Run full test suite
- Run type checking
- Run linting
- Manually verify any changed public APIs
- Check that no unused imports/exports were left behind

### 5. Clean up
- Remove any dead code created by the refactoring
- Update imports and barrel exports
- Ensure consistent naming throughout

## Rules:
- NEVER change behavior during refactoring - structure only
- If you need to change behavior too, do it in a separate step
- Always have passing tests before AND after
- If no tests exist for the target code, write them first
- Keep commits atomic - one logical change per commit
