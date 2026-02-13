---
name: fix-issue
description: Fix a GitHub issue by number. Reads the issue, implements the fix, writes tests, and creates a commit.
disable-model-invocation: true
argument-hint: "[issue-number]"
---

Fix GitHub issue #$ARGUMENTS

## Workflow:

### 1. Read the issue
- Fetch issue details: `gh issue view $ARGUMENTS`
- Understand the problem, expected behavior, and any reproduction steps
- Check issue comments for additional context

### 2. Investigate
- Find the relevant code based on the issue description
- Reproduce the problem if possible
- Identify the root cause

### 3. Implement the fix
- Make the minimal change needed to resolve the issue
- Follow existing code patterns and conventions
- Add/update tests to cover the fix

### 4. Verify
- Run the test suite
- Run type checking and linting
- Verify the fix addresses the issue requirements

### 5. Create commit
- Stage the changes
- Create a commit with message: `fix: [description] (closes #$ARGUMENTS)`
- Follow conventional commit format

### 6. Report
Summarize what was done:
- Root cause
- What was changed and why
- Tests added
- Any follow-up work needed
