# Mandatory Logging Rules Added to CLAUDE.md

**Date**: 2025-01-24 16:15
**Author**: main-claude

## Summary
Added mandatory logging and documentation rules to the TOP of CLAUDE.md to ensure they are followed in EVERY session, including new chats.

## Added
- **MANDATORY section** at the very top of CLAUDE.md with 3 critical rules:
  1. Agent Usage Logging - Log every agent call to `agent-usage.log`
  2. Changelog for Code Changes - Create changelog after any code modification
  3. Session Completion Checklist - Verify logging and docs before completing

## Files Modified
- `CLAUDE.md` - Added mandatory section at top (before all other content)

## Context
The previous logging instructions were being missed because:
1. They were buried in the middle of the document
2. New sessions didn't see the agent config instructions
3. There was no clear "must do" checklist

By placing the mandatory rules at the VERY TOP of CLAUDE.md with clear formatting (warning emoji, horizontal rules, checkboxes), they will be seen and followed in every session regardless of which agent is used.

## Verification
These rules will now persist across:
- New chat sessions
- Different agents (main Claude, orchestrator, dev agents)
- Context resets
