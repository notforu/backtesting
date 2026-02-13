---
name: scaffold
description: Scaffold new components, modules, API routes, or project structures. Follows existing project patterns and conventions.
disable-model-invocation: true
---

Scaffold: `$ARGUMENTS`

## Workflow:

1. **Analyze existing patterns**: Before creating anything, explore the codebase to understand:
   - File naming conventions (camelCase, kebab-case, PascalCase)
   - Directory structure and where similar code lives
   - Import patterns and module organization
   - Testing patterns (co-located, separate __tests__ dir, etc.)
   - Type/interface patterns

2. **Identify what to create**: Based on the request, determine which files are needed:
   - Main implementation file
   - Type definitions (if separate)
   - Test file (matching project's test pattern)
   - Index/barrel exports (if project uses them)

3. **Generate files**: Create each file following discovered patterns:
   - Match existing code style exactly
   - Include proper imports
   - Add TODO comments for business logic the user needs to fill in
   - Wire up exports/registrations

4. **Verify**: Run type checking to ensure generated code compiles

## Rules:
- NEVER invent new patterns - always follow existing project conventions
- If no existing pattern is found, ask the user before deciding
- Include minimal but working boilerplate (not empty shells)
- Add brief comments explaining the scaffold structure
