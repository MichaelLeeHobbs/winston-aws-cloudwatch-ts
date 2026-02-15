# PR Review Checklist — Mission-Critical TypeScript

This checklist covers all **shall-level** (mandatory) rules from the coding standard. Every PR must pass all applicable items before merge.

## Type Safety (Rules 3.1, 3.2, 3.5)

- [ ] No `any` type usage — use `unknown` + type guards or generics
- [ ] No traditional `enum` — use `as const` objects or string literal unions
- [ ] No type assertions (`as Type`, `!`) without justification comments
- [ ] `tsconfig.json` strict options not weakened by the PR

## Variable Declarations (Rule 5.2)

- [ ] No `var` — use `const` by default, `let` only when reassignment is needed
- [ ] Variables scoped as narrowly as possible

## Error Handling (Rules 6.1, 6.2)

- [ ] `throw` reserved for unrecoverable panics only — not for control flow
- [ ] Fallible functions return `Result<T, E>` instead of throwing
- [ ] All Result values checked (`if (!result.ok)`) before accessing `.value`
- [ ] Structured error context in error messages

## Async & Promises (Rules 4.1, 4.2, 4.3)

- [ ] No floating promises — all `await`ed, `.then/.catch`ed, or returned
- [ ] All async operations have timeouts (`AbortController` + `Promise.race`)
- [ ] `Promise.all` bounded (e.g., via `p-limit`) — no unbounded on user input
- [ ] Resources cleaned up in `finally` blocks

## Control Flow (Rules 8.1, 8.2, 8.3, 8.4)

- [ ] No recursion — use iterative algorithms with explicit stacks
- [ ] All loops have documented upper bounds
- [ ] All `switch` statements and union checks exhaustive with `default: assertUnreachable(x)`
- [ ] Functions ≤ 40 lines (excluding comments/blanks)
- [ ] Functions ≤ 4 parameters (use options objects for more)
- [ ] Max 3 levels of nesting

## Defensive Coding (Rules 7.1, 7.2, 7.3, 7.4)

- [ ] `readonly` on interfaces, parameters, and data structures
- [ ] All external inputs validated at boundaries (Zod schemas preferred)
- [ ] Branded types for domain primitives (no raw string for emails, IDs, etc.)
- [ ] No hardcoded secrets — env vars or vault references only
- [ ] Output sanitized (no SQL injection, XSS, etc.)

## Dependencies (Rule 3.4)

- [ ] All dependency versions pinned to exact (no `^`, `~`, `*`, ranges)
- [ ] No dynamic `require()` or `import()` — static ESM only
- [ ] New dependencies justified (Node.js built-in alternatives considered)

## Documentation (Rules 10.1, 10.2)

- [ ] TSDoc on all new/modified public functions with `@param`, `@returns`, `@throws`
- [ ] ADR created for significant architectural decisions
- [ ] CHANGELOG updated (if the project maintains one)

## Testing (Rules 9.1, 9.2)

- [ ] Every new/modified source file has corresponding test file
- [ ] Tests cover success paths, error paths, and edge cases
- [ ] Property-based tests for algorithms and data transformations
- [ ] No test-only weakening of types (no `as any` in tests)

## Resources & Memory (Rules 5.1, 5.3)

- [ ] Event listeners paired with cleanup (`on`/`off`, `once`)
- [ ] Timers cleared in `finally` or disposal hooks
- [ ] No `this` in callbacks without explicit binding
