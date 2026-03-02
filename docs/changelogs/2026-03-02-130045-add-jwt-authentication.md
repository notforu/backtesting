# JWT Authentication System + Position Display Enhancement

**Date**: 2026-03-02 13:00
**Author**: dev-team

## Summary
Added complete JWT authentication system to the platform with user management, login functionality, and integrated auth validation across all API routes. Enhanced paper trading position display to show all position fields in a detailed table format instead of cards. Database migration adds users table with FK relationships to existing data structures.

## Changed
- **Database schema**: Added `users` table, FK to `paper_sessions`, `backtest_runs`, and `aggregation_configs`
- **Auth validation**: All API routes now require JWT authentication (except `/api/health` and `/api/auth/*`)
- **Frontend auth state**: Login credentials persisted to localStorage with token injection in all API calls
- **Paper trading UI**: Position cards replaced with detailed table showing direction, symbol, amount, entry price, entry time, unrealized P&L, funding accumulated
- **Startup**: Root user password updated from `ROOT_PASSWORD` env var on every startup

## Added
- **Backend auth module** (`src/auth/`):
  - `password.ts` - bcrypt hashing (12 rounds) for secure password storage
  - `jwt.ts` - JWT sign/verify with 7-day expiry and configurable `JWT_SECRET`
  - `db.ts` - User CRUD operations and `ensureRootUser()` initialization
  - `hook.ts` - Fastify onRequest hook for token validation
  - `index.ts` - Barrel export for auth module
- **Backend auth routes** (`src/api/routes/auth.ts`):
  - `POST /api/auth/login` - Login with username/password, returns JWT token
  - `GET /api/auth/me` - Get current authenticated user info
- **Frontend auth components**:
  - `src/web/stores/authStore.ts` - Zustand store for auth state and token persistence
  - `src/web/components/LoginPage.tsx` - Clean login form with error handling
  - App wrapper authentication check with logout functionality
- **CLI user management**: `npm run user:create <username> <password> [role]` script to create new users
- **Database migration**: `010_add_auth.sql` creates users table and updates existing rows with nullable user_id

## Fixed
- Paper trading positions now display all critical fields in readable table format
- Auth token properly injected in all API requests and SSE streams

## Files Modified
- `src/auth/password.ts` - New password hashing module
- `src/auth/jwt.ts` - New JWT token management
- `src/auth/db.ts` - New user database operations
- `src/auth/hook.ts` - New Fastify auth middleware hook
- `src/auth/index.ts` - New auth module barrel export
- `src/api/server.ts` - Register auth hook and initialize root user
- `src/api/routes/auth.ts` - New authentication endpoints
- `src/web/stores/authStore.ts` - New Zustand auth store
- `src/web/components/LoginPage.tsx` - New login page component
- `src/web/main.tsx` - App wrapper with auth guard
- `src/web/api/client.ts` - Token injection in API calls
- `src/web/components/PaperTradingPage.tsx` - Positions display as table
- `migrations/010_add_auth.sql` - New database migration
- `scripts/create-user.ts` - New CLI user creation script
- `package.json` - Added `bcryptjs` and `jsonwebtoken` dependencies

## Context
Authentication is critical for multi-user scenarios and paper trading tracking. The system uses:
- **Bearer tokens** for stateless auth, validated on every request
- **Root user**: Seeded at startup with password from `ROOT_PASSWORD` env var (allows dynamic credential rotation)
- **Query param fallback**: SSE streams use `?token=` since headers not supported
- **Backward compatibility**: All nullable user_id columns preserve existing data

The position table enhancement provides traders with complete position visibility in one view rather than scattered card information, enabling quick decision-making during active trading sessions.

## Environment Variables
- `JWT_SECRET` - JWT signing secret (defaults to `dev-secret-change-in-production`)
- `ROOT_PASSWORD` - Root user password (defaults to `admin`, updated on every startup)

## Testing Checklist
- [ ] Root user created successfully with env var password
- [ ] Login returns valid JWT token
- [ ] Protected API routes reject requests without auth
- [ ] Token injection works in API calls and SSE
- [ ] 401 responses trigger logout + reload
- [ ] Paper trading positions display correctly in table format
- [ ] User creation CLI script works
