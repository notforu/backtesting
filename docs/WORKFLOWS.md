# Development Workflows

## Git Workflow

**Branch Strategy**: Direct to main
- Commit small, working changes directly to main
- Use descriptive commit messages
- No feature branches unless explicitly needed

```bash
# Typical workflow
git add <specific-files>
git commit -m "feat: add SMA crossover strategy"
git push
```

## Agent Coordination

### When to Use Which Agent

| Task Type | Agent | Example |
|-----------|-------|---------|
| Multi-area feature | `orchestrator` | "Add new strategy with UI controls" |
| React components | `fe-dev` | "Create chart component" |
| API endpoints | `be-dev` | "Add candle fetching endpoint" |
| Bug investigation | `qa` | "Tests failing after refactor" |
| Dependencies/build | `builder` | "Add new npm package" |

### Communication Flow

```
User Request
     │
     ▼
Orchestrator (analyzes, breaks down)
     │
     ├──► fe-dev (UI tasks)
     │       │
     │       └──► Updates TaskList
     │
     ├──► be-dev (API/engine tasks)
     │       │
     │       └──► Updates TaskList
     │
     └──► qa (verification)
             │
             └──► Updates docs if needed
```

### Task States

```
pending ──► in_progress ──► completed
                │
                └──► blocked (waiting on dependency)
```

## Quality Checklist

Before marking any task complete:

```bash
# 1. Type check
npm run typecheck

# 2. Lint
npm run lint

# 3. Tests (if applicable)
npm test

# 4. Manual verification
npm run dev  # Check it works
```

## Adding a New Strategy

1. **Create file** in `/strategies/`
   ```typescript
   // strategies/my-strategy.ts
   import { Strategy, StrategyContext } from '../src/strategy/base';

   export const myStrategy: Strategy = {
     name: 'my-strategy',
     description: 'Description here',
     version: '1.0.0',
     params: [
       { name: 'period', type: 'number', default: 14 }
     ],
     onInit(ctx) { /* setup */ },
     onBar(ctx) { /* main logic */ },
     onOrderFilled(ctx, order) { /* handle fills */ },
     onEnd(ctx) { /* cleanup */ }
   };
   ```

2. **Test manually**
   ```bash
   npm run backtest -- --strategy my-strategy --symbol BTCUSDT
   ```

3. **Verify in UI**
   - Strategy should appear in dropdown
   - Parameters should render correctly
   - Backtest should execute and show results

## Adding a New API Endpoint

1. **Create route** in `src/api/routes/`
2. **Add to server** in `src/api/server.ts`
3. **Add types** for request/response
4. **Test with curl or UI**
5. **Document in** `docs/API.md`

## Adding a New UI Component

1. **Create component** in `src/web/components/`
2. **Add stories** if using Storybook (future)
3. **Connect to API** via React Query hooks
4. **Test in browser**
5. **Update** `docs/UI.md` if significant

## Database Migrations

SQLite schema changes:

1. **Update schema** in `src/data/db.ts`
2. **Add migration** function
3. **Version the schema** (increment version number)
4. **Test with fresh DB** and existing DB

```typescript
// src/data/db.ts
const SCHEMA_VERSION = 2;

const migrations = {
  1: (db) => { /* v1 schema */ },
  2: (db) => { /* v1 -> v2 changes */ }
};
```

## Debugging Strategies

1. **Enable logging** in strategy context
   ```typescript
   onBar(ctx) {
     ctx.log(`Price: ${ctx.currentBar.close}`);
   }
   ```

2. **Check trade history** in results
3. **Visualize on chart** - trades should appear as markers
4. **Compare with manual calculation** for simple cases

## Performance Testing

For large backtests:

1. **Profile with Node.js inspector**
   ```bash
   node --inspect dist/backtest.js
   ```

2. **Check memory usage** for long date ranges
3. **Optimize hot paths** (indicator calculations, loops)

## Chat Log Format

After each session, create/update chat log:

```markdown
# YYYY-MM-DD Session

## Summary
Brief description of what was accomplished.

## Changes Made
- File1.ts: Added X feature
- File2.ts: Fixed Y bug

## Decisions
- Decided to use Z approach because...

## Open Questions
- Should we do A or B?

## Next Steps
- [ ] Task 1
- [ ] Task 2
```
