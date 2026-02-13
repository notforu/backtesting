---
name: review
description: Review code changes for bugs, security issues, performance problems, and improvements. Use before committing or when wanting a second opinion on code.
context: fork
agent: Explore
---

Review the current code changes thoroughly.

## Steps:

1. **Get the diff**: Run `git diff` and `git diff --staged` to see all changes
2. **Understand context**: Read the modified files to understand the full picture
3. **Review for issues**: Check each category below

## Review checklist:

### Correctness
- Logic errors or edge cases missed
- Off-by-one errors, null/undefined handling
- Race conditions in async code
- Incorrect type usage

### Security (OWASP Top 10)
- SQL injection, XSS, command injection
- Hardcoded secrets or credentials
- Insecure data handling
- Missing input validation at boundaries

### Performance
- N+1 queries or unnecessary loops
- Memory leaks (event listeners, subscriptions)
- Missing pagination for large datasets
- Expensive operations in hot paths

### Code quality
- Dead code or unused imports
- Duplicated logic that should be extracted
- Unclear naming or missing context
- Overly complex logic that could be simplified

## Output format:

For each finding:
```
[SEVERITY] file:line - Description
  → Suggestion: How to fix it
```

Severities: CRITICAL, WARNING, INFO

End with a summary: total findings by severity and overall assessment (LGTM / Needs changes / Needs discussion).
