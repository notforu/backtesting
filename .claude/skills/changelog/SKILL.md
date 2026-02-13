---
name: changelog
description: Generate a changelog entry for recent changes. Creates a timestamped file in docs/changelogs/.
disable-model-invocation: true
---

Generate a changelog for recent changes: `$ARGUMENTS`

## Workflow:

1. **Get changes**: Run `git diff HEAD` and `git log --oneline -5` to understand what changed
2. **Analyze impact**: Categorize the change (feature, fix, refactor, breaking change, etc.)
3. **Write changelog**: Create a file at `/docs/changelogs/YYYY-MM-DD-HHMMSS-brief-title.md`

## Changelog format:

```markdown
# [Brief Title]

**Date**: YYYY-MM-DD HH:MM
**Type**: feature | fix | refactor | breaking | docs | chore

## Summary
One paragraph describing what changed and why.

## Changes
- Bullet list of specific changes made
- Include file paths for significant modifications

## Impact
- What existing behavior changed (if any)
- Migration steps needed (if breaking)
```

## Rules:
- Use LOCAL timezone for the datetime
- Keep the title under 60 characters
- Focus on WHAT changed and WHY, not HOW
- If it's a breaking change, always include migration steps
