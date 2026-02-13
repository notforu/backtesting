---
name: test-gen
description: Generate tests for a file, function, or module. Creates unit tests with edge cases, following the project's testing patterns.
disable-model-invocation: true
---

Generate tests for: `$ARGUMENTS`

## Workflow:

### 1. Analyze the target
- Read the file/function to understand its behavior
- Identify inputs, outputs, side effects, and error conditions
- Check existing tests in the project for patterns

### 2. Discover testing setup
- Find the test framework (Jest, Vitest, Mocha, Playwright, etc.)
- Find existing test files to match patterns:
  - File naming: `*.test.ts`, `*.spec.ts`, `__tests__/`
  - Import style, describe/it nesting
  - Mock patterns, setup/teardown
  - Assertion style

### 3. Generate test cases

**Happy path**: Normal expected behavior with typical inputs

**Edge cases**:
- Empty/null/undefined inputs
- Boundary values (0, -1, MAX_INT, empty string, empty array)
- Single item vs many items
- Unicode, special characters

**Error cases**:
- Invalid input types
- Network failures (if applicable)
- Missing dependencies
- Permission errors

**Integration points**:
- Mocking external dependencies
- Database interactions
- API calls

### 4. Write the test file
- Match the project's exact test patterns
- Use descriptive test names that explain the expected behavior
- Group related tests in describe blocks
- Add brief comments for non-obvious test cases

### 5. Verify
- Run the generated tests to ensure they pass
- Run type checking on test files

## Rules:
- Tests should be deterministic - no reliance on timing, random values, or external state
- Each test should test ONE thing
- Test behavior, not implementation details
- Prefer real objects over mocks when practical
