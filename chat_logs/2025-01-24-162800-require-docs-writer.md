# Changelog - 2025-01-24

## Summary
Updated CLAUDE.md Rule 3 to ALWAYS require docs-writer agent for changelogs (no manual creation).

## Why
- Manual changelog creation doesn't appear in agent-usage.log
- Creates inconsistency - changelogs exist but no docs-writer entry
- Now every changelog will have a matching docs-writer log entry
- Improves tracking of documentation work and token usage

## Changes Made

### File: `CLAUDE.md`
- **Rule 3 (Changelog for Code Changes)** - Updated to require docs-writer agent
  - Removed: "Or manually create..." option
  - Now: "ALWAYS call `docs-writer` agent to create changelog"
  - Added: "DO NOT create changelogs manually"
  - Added: Note about consistent logging and formatting

### Key Updates
- Line 36: Rule 3 header emphasizes ALWAYS call docs-writer
- Line 37: Explicit "DO NOT create changelogs manually"
- Line 39: Explains the reasoning (ensures consistent logging and formatting)
- Removed legacy manual changelog section (previously lines 187-202)

## Impact
- All future changelogs will be created via docs-writer agent
- Ensures /chat_logs/agent-usage.log tracks all documentation work
- Maintains consistency in changelog format and metadata
- Prevents gaps in agent usage logging

## Files Modified
- `/Users/notforu/WebstormProjects/backtesting/CLAUDE.md` - Rule 3 updated

## Technical Notes
- This change doesn't affect code functionality, only documentation workflow
- docs-writer agent already had this capability
- Change makes the requirement explicit and eliminates the manual workaround
