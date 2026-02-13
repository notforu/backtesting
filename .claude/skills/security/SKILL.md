---
name: security
description: Security audit for common vulnerabilities. Scans for OWASP top 10, hardcoded secrets, insecure patterns, and dependency issues.
context: fork
agent: Explore
---

Run a security audit on the codebase. Focus on: `$ARGUMENTS`

If no specific focus given, scan the entire project.

## Scan checklist:

### 1. Hardcoded secrets
- Search for API keys, tokens, passwords in source code
- Check for .env files committed to git
- Look for base64-encoded secrets
- Patterns: `password`, `secret`, `api_key`, `token`, `private_key`, `credentials`

### 2. Injection vulnerabilities
- **SQL injection**: Raw queries with string concatenation
- **Command injection**: Shell exec with user input
- **XSS**: Unescaped user content in HTML/templates
- **Path traversal**: User input in file paths without sanitization

### 3. Authentication & authorization
- Missing auth checks on protected routes
- Weak password requirements
- Session management issues
- Missing CSRF protection

### 4. Data exposure
- Sensitive data in logs
- Verbose error messages in production
- Missing rate limiting on sensitive endpoints
- Overly permissive CORS configuration

### 5. Dependencies
- Run `pnpm audit` (or equivalent) for known vulnerabilities
- Check for outdated packages with known CVEs

### 6. Configuration
- Debug mode enabled in production configs
- Insecure default settings
- Missing security headers

## Output format:

For each finding:
```
[CRITICAL/HIGH/MEDIUM/LOW] Category - file:line
  Description: What's wrong
  Impact: What could happen
  Fix: How to remediate
```

End with summary table of findings by severity.
