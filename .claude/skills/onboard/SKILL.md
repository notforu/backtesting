---
name: onboard
description: Explore and understand a new codebase. Generates a comprehensive overview of architecture, patterns, and key files.
context: fork
agent: Explore
---

Explore this codebase thoroughly and generate a comprehensive onboarding guide.

Focus on: `$ARGUMENTS` (if empty, analyze the entire project)

## Analysis steps:

### 1. Project basics
- Package manager and dependencies (package.json, etc.)
- Build system and scripts
- Language and framework versions
- Development setup requirements

### 2. Architecture
- Entry points (where does execution start?)
- Directory structure and organization pattern
- Key abstractions and design patterns used
- Data flow (how does data move through the system?)

### 3. Key files
- Configuration files and their purpose
- Core business logic locations
- Type definitions and shared interfaces
- Database schema/migrations

### 4. Patterns and conventions
- Naming conventions (files, variables, functions)
- Error handling patterns
- State management approach
- Testing patterns and coverage

### 5. External integrations
- APIs consumed or exposed
- Database connections
- Third-party services
- Environment variables needed

## Output format:

Generate a structured markdown document with:
1. One-paragraph project summary
2. Architecture diagram (Mermaid)
3. Key files table (file → purpose)
4. Getting started steps
5. Important patterns to follow
6. Gotchas and things to watch out for
