# Deep Review Checklist — Mission-Critical TypeScript

Comprehensive checklist covering all coding standard rules for deep review analysis.

## Compiler & Tooling (Section 3)

### Rule 3.1: Strict Compiler Configuration
- [ ] `strict: true` in tsconfig.json
- [ ] All additional strict flags enabled (noUncheckedIndexedAccess, exactOptionalPropertyTypes, etc.)
- [ ] `skipLibCheck: false`

### Rule 3.2: Zero Tolerance for `any`
- [ ] No `any` in source code
- [ ] No `any` in type assertions without documented justification
- [ ] `unknown` used for untyped inputs with proper narrowing

### Rule 3.3: Static Analysis
- [ ] ESLint configured with @typescript-eslint
- [ ] `--max-warnings 0` enforced
- [ ] Pre-commit hooks running lint + type-check

### Rule 3.4: Dependency Management
- [ ] All versions pinned to exact (no ^, ~, *, ranges)
- [ ] All imports static ESM (no dynamic require/import)
- [ ] Minimal third-party deps (prefer Node.js built-ins)

### Rule 3.5: No Traditional Enums
- [ ] No `enum` keyword in source code
- [ ] Using `as const` objects or string literal unions instead

## Async Execution (Section 4)

### Rule 4.1: No Floating Promises
- [ ] Every Promise is awaited, .then/.catch'd, or returned
- [ ] No `void` on async calls without documented justification

### Rule 4.2: Mandatory Timeouts
- [ ] All network/IO operations have timeouts
- [ ] AbortController used for cancellation
- [ ] Default timeout ≤ 30 seconds

### Rule 4.3: Bounded Parallelism
- [ ] Promise.all bounded (p-limit or semaphore)
- [ ] No unbounded parallel operations on user-controlled input

### Rule 4.4: Async Iteration Safety
- [ ] for-await-of only on trusted iterables
- [ ] Custom async iterators implement cancellation

## Scope & Memory (Section 5)

### Rule 5.1: Resource Disposal
- [ ] Event listeners paired with cleanup
- [ ] Timers cleared in finally/dispose
- [ ] Streams properly closed

### Rule 5.2: No `var`
- [ ] const by default, let only when needed
- [ ] No global variables

### Rule 5.3: Safe `this`
- [ ] Arrow functions for callbacks
- [ ] Explicit `this` typing where dynamic binding used

## Error Handling (Section 6)

### Rule 6.1: Reserved Exceptions
- [ ] throw only for unrecoverable panics
- [ ] No throw for control flow (validation, expected IO failures)

### Rule 6.2: Result Pattern
- [ ] Fallible functions return Result<T, E>
- [ ] All Result values checked before accessing .value
- [ ] tryCatch/tryCatchSync used for wrapping

### Rule 6.3: Logging
- [ ] Structured logger used (not console.log in production)
- [ ] Error context included (stack, inputs, request IDs)
- [ ] No sensitive data in logs

## Defensive Coding (Section 7)

### Rule 7.1: Immutability
- [ ] readonly on interfaces and parameters
- [ ] ReadonlyArray, ReadonlyMap, ReadonlySet used
- [ ] No in-place mutations of function arguments

### Rule 7.2: Runtime Validation
- [ ] All external inputs validated (Zod preferred)
- [ ] Type guards used instead of assertions
- [ ] Outputs sanitized (XSS, SQL injection prevention)

### Rule 7.3: Branded Types
- [ ] Domain primitives use branded types (not raw string/number)
- [ ] Factory functions validate before branding

### Rule 7.4: Security
- [ ] No hardcoded secrets
- [ ] Parameterized queries (no SQL concatenation)
- [ ] Security headers set on HTTP responses
- [ ] Audited crypto libraries only

## Control Flow (Section 8)

### Rule 8.1: Bounded Loops
- [ ] All loops have documented upper bounds
- [ ] No while(true) without counter + max check

### Rule 8.2: No Recursion
- [ ] No direct recursion
- [ ] No mutual/indirect recursion
- [ ] Iterative algorithms with explicit stacks

### Rule 8.3: Exhaustive Matching
- [ ] All switch statements have default: assertUnreachable
- [ ] All union type checks are exhaustive

### Rule 8.4: Function Design
- [ ] Functions ≤ 40 lines
- [ ] Functions ≤ 4 parameters
- [ ] Single responsibility
- [ ] Max 3 levels of nesting

## Testing (Section 9)

### Rule 9.1: Test Coverage
- [ ] ≥95% branch coverage
- [ ] Edge cases tested (empty, null, boundary)
- [ ] Property-based tests for algorithms

### Rule 9.2: Fuzzing
- [ ] Critical paths fuzzed (auth, payments, persistence)

### Rule 9.3: Observability
- [ ] Metrics instrumented for critical functions
- [ ] Health check endpoints

## Documentation (Section 10)

### Rule 10.1: TSDoc
- [ ] All public APIs documented
- [ ] @param, @returns, @throws annotations
- [ ] Usage examples for complex functions

### Rule 10.2: ADRs
- [ ] Significant decisions documented in docs/adr/

### Rule 10.3: Modularity
- [ ] Clear module boundaries
- [ ] No circular dependencies
- [ ] Dependency Inversion (domain doesn't depend on infrastructure)
