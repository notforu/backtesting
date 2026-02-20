# Fix: Select Parameter Rendering for String Arrays and Object Arrays

## Problem
The frontend select param rendering in `StrategyConfig` failed when strategy backend params used `options: string[]` (e.g., `['conservative', 'moderate', 'custom']`). The component expected only object arrays with `{ value, label }` structure, causing `opt.value` and `opt.label` to be `undefined` for plain strings.

## Changes

### 1. `/workspace/src/web/types.ts` (line 126)
Updated the `StrategyParam.options` type to accept both formats:
```typescript
// Before
options?: Array<{ value: string | number; label: string }>;

// After
options?: string[] | Array<{ value: string | number; label: string }>;
```

### 2. `/workspace/src/web/components/StrategyConfig/StrategyConfig.tsx` (lines 107-129)
Updated the `select` case in `ParamInput` to handle both string arrays and object arrays:
```typescript
// Before
{param.options?.map((opt) => (
  <option key={opt.value} value={opt.value}>
    {opt.label}
  </option>
))}

// After
{param.options?.map((opt) => {
  const value = typeof opt === 'string' ? opt : opt.value;
  const label = typeof opt === 'string' ? opt : opt.label;
  return (
    <option key={String(value)} value={String(value)}>
      {label}
    </option>
  );
})}
```

## Validation
- TypeScript compilation: PASS
- No breaking changes to existing code (backward compatible)
- Strategies with both `string[]` and `{ value, label }[]` options now work correctly
