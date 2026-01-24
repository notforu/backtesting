# Agent Usage Logging System

**Date**: 2025-01-24 15:00
**Author**: docs-writer

## Summary
Added logging system to track agent invocations for token consumption analysis.

## Added
- `/chat_logs/agent-usage.log` - Central log for tracking agent invocations
- Logging instructions added to all agent configs
- Token cost reference (opus ~10x, sonnet ~3x, haiku 1x)

## Files Modified
- `CLAUDE.md` - Added agent usage logging instructions
- `.claude/agents/*.md` - All agents now have logging reminder

## Context
Helps track token consumption patterns across agents. Each agent logs when completing tasks, allowing analysis of which agents consume most resources.
