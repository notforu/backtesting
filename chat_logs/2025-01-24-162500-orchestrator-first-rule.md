# Orchestrator-First Rule Enforcement

**Date**: 2025-01-24 16:25
**Author**: main-claude

## Summary
Strengthened CLAUDE.md to enforce that ALL code tasks must go through the orchestrator agent first. Previously, main Claude was bypassing orchestrator and calling fe-dev/be-dev directly.

## Problem
Agent usage logs showed direct calls to specialized agents (fe-dev, be-dev) without going through orchestrator first. This breaks the coordination pattern and makes it harder to track work.

## Changed
- `CLAUDE.md` - Completely rewrote mandatory rules section

### New Rule Structure
1. **RULE 1: ALWAYS USE ORCHESTRATOR** - Most prominent, with explicit "DO NOT" instructions
2. **RULE 2: Log Every Agent Call** - Unchanged
3. **RULE 3: Changelog for Code Changes** - Unchanged
4. **RULE 4: Session Completion Checklist** - Added orchestrator verification

### Key Changes
- Moved orchestrator rule to be FIRST and most prominent
- Added explicit "DO NOT call fe-dev, be-dev directly"
- Added code block showing correct pattern
- Listed only 3 exceptions (trivial fixes, exploring, committing)
- Updated checklist to verify orchestrator usage

## Files Modified
- `CLAUDE.md` - Mandatory rules section rewritten

## Context
The orchestrator agent is designed to:
- Break down complex tasks
- Coordinate between agents
- Ensure proper logging via docs-writer
- Maintain consistent patterns

Bypassing it leads to missing logs, inconsistent patterns, and harder tracking.
