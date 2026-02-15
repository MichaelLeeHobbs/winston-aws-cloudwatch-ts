---
name: scaffold-module
description: Generate a new module with types, schema validation, tests, and barrel export following the coding standard
disable-model-invocation: true
arguments:
  - name: name
    description: "Module name in kebab-case (e.g., 'user-profile', 'payment-processor')"
    required: true
---

# Scaffold a New Module

You are generating a new module under `src/` that fully complies with the mission-critical coding standard.

## Module name

The module name is: **$ARGUMENTS**

## Instructions

1. **Parse the module name** — The name should be in `kebab-case`. Convert to `PascalCase` for type names and `camelCase` for variable names. For example:
   - `user-profile` → types: `UserProfile`, variables: `userProfile`, directory: `src/user-profile/`

2. **Check for conflicts** — Verify `src/${MODULE_NAME}/` does not already exist. If it does, ask the user whether to overwrite or abort.

3. **Load the coding standard** (optional reference) — Check if `documents/TypeScript Coding Standard for Mission-Critical Systems.md` exists. Use it as context for generating compliant code.

4. **Ask the user about the module** — Gather:
   - What does this module do? (brief description)
   - What are the key domain types? (e.g., "User has id, email, name" or "Payment has amount, currency, status")
   - What are the main operations? (e.g., "create, validate, process")

5. **Read the templates** — Read the following templates from `.claude/skills/scaffold-module/templates/`:
   - `module.ts.template` — Main module logic
   - `module.test.ts.template` — Test file
   - `module.schema.ts.template` — Zod schemas and branded types

6. **Generate the module files** — Create the following files, using the templates as structural guides but filling in actual domain-specific code based on the user's answers:

   ### `src/${MODULE_NAME}/schema.ts`
   Based on `module.schema.ts.template`:
   - Zod schemas for all domain types (Rule 7.2)
   - Branded types for domain primitives (Rule 7.3)
   - Factory functions returning `Result<T>` (Rule 6.2)
   - All types exported with `readonly` properties (Rule 7.1)

   ### `src/${MODULE_NAME}/${MODULE_NAME}.ts`
   Based on `module.ts.template`:
   - Import types and schemas from `./schema.js`
   - Import `Result` type from `../utils/result.js`
   - All functions return `Result<T>` for fallible operations (Rule 6.2)
   - Functions ≤ 40 lines, ≤ 4 parameters (Rule 8.4)
   - `readonly` on all data (Rule 7.1)
   - Exhaustive switch with `assertUnreachable` for any unions (Rule 8.3)
   - TSDoc on all public functions (Rule 10.1)
   - No `any`, no `enum`, no `var`, no recursion

   ### `src/${MODULE_NAME}/${MODULE_NAME}.test.ts`
   Based on `module.test.ts.template`:
   - Import from the module under test
   - Unit tests for every exported function
   - Edge cases: empty input, null/undefined, boundary values (Rule 9.1)
   - Property-based tests with `fast-check` for data transformation functions (Rule 9.1)
   - Test both success and error paths of Result-returning functions
   - Use `describe`/`it` blocks with descriptive names

   ### `src/${MODULE_NAME}/index.ts`
   Barrel export re-exporting public types and functions from the module files.

7. **Update parent barrel export** — If `src/index.ts` exists, append `export * from './${MODULE_NAME}/index.js';`. If it doesn't exist, create it.

8. **Summary** — List all created files and suggest the user run tests with `npm test`.
