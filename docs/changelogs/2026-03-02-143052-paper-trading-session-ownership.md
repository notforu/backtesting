# Paper Trading Session Ownership

**Date**: 2026-03-02 14:30
**Author**: claude-code

## Summary
Implemented session ownership for paper trading. Sessions are now visible to all authenticated users (read-only), but only the owner can manage them. Mutation endpoints enforce ownership checks with 403 errors for unauthorized users. Admin users bypass all ownership checks.

## Changed
- Session visibility: all authenticated users can view sessions
- Session management: only owner can start, stop, pause, resume, delete, or force-tick
- Admin bypass: admin role treats as owner for all operations
- Ownership enforced at API layer with 403 Forbidden responses

## Added
- `userId` field to `PaperSession` type (backend and frontend)
- Ownership checks in all mutation endpoints
- "View Only" badge in UI for non-owners
- Control button visibility logic based on ownership
- Migration `011_add_user_id_to_paper_sessions.sql`

## Fixed
- Sessions no longer globally mutable by any authenticated user
- Admin users can override ownership for moderation/support purposes

## Files Modified
- `src/types.ts` - Added `userId?: string` to `PaperSession` type
- `src/data/db.ts` - All paper session queries now include/filter by `user_id`
- `src/api/routes/paper-trading.ts` - Added ownership checks to mutation endpoints:
  - `startSession()` - 403 if not owner
  - `stopSession()` - 403 if not owner
  - `pauseSession()` - 403 if not owner
  - `resumeSession()` - 403 if not owner
  - `deleteSession()` - 403 if not owner
  - `forceTick()` - 403 if not owner
- `src/core/session-manager.ts` - Accepts `userId` parameter in session creation
- `src/web/types.ts` - Added `userId?: string` to frontend `PaperSession` type
- `src/web/components/PaperTrading.tsx` - Control visibility logic:
  - Hidden for non-owners
  - "View Only" badge when user doesn't own session
- `migrations/011_add_user_id_to_paper_sessions.sql` - New migration

## Context
Session ownership prevents users from accidentally or intentionally interfering with other users' backtests. The implementation maintains backward compatibility (userId is optional) while enforcing ownership at the API layer. Read access remains open to support collaboration and visibility, while write access is strictly controlled.

Read endpoints (list, detail, trades, equity, events, SSE stream) remain open to all authenticated users to support monitoring and analysis without ownership restrictions.
