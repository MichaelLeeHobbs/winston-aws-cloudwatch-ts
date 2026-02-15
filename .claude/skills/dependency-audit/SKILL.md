---
name: dependency-audit
description: Audit project dependencies for pinning, security, licensing, and compliance with Rule 3.4
disable-model-invocation: true
---

# Audit Project Dependencies

You are performing a read-only audit of this project's dependencies against the mission-critical coding standard (Rule 3.4). You **do not** modify any files — you only report findings.

## Instructions

1. **Load the coding standard** (optional reference) — Check if `documents/TypeScript Coding Standard for Mission-Critical Systems.md` exists. If present, use it to cross-reference specific rules. If absent, apply the rules described below.

2. **Read package.json** — Read `package.json` from the project root. If it does not exist, report that and stop.

3. **Check version pinning (Rule 3.4)** — For every dependency in `dependencies` and `devDependencies`:
   - Flag any version that uses `^`, `~`, `>=`, `>`, `<`, `<=`, `*`, or `x` ranges
   - Correct format is exact version only (e.g., `"4.17.21"`)
   - Report each unpinned dependency with its current specifier

4. **Check for unnecessary dependencies** — Flag dependencies where a Node.js built-in could be used instead. Common examples:
   - `axios`, `node-fetch`, `got` → `fetch` (Node.js 18+ built-in)
   - `uuid` → `crypto.randomUUID()` (Node.js 19+)
   - `path-to-regexp` → check if needed vs built-in URL/path parsing
   - `fs-extra` → `fs/promises` (Node.js built-in)
   - `rimraf` → `fs.rm` with `{ recursive: true }` (Node.js 14.14+)
   - `mkdirp` → `fs.mkdir` with `{ recursive: true }`
   - `glob` → `fs.glob` (Node.js 22+) or `node:path` patterns

5. **Run npm audit** — Execute `npm audit --json` (if `node_modules` exists) or `npm audit --package-lock-only --json` (if `package-lock.json` exists). Parse the JSON output and report:
   - Total vulnerabilities by severity (critical, high, moderate, low)
   - Top 5 most severe vulnerabilities with package name, severity, and advisory URL

6. **Check for dynamic imports (Rule 3.4)** — Search the `src/` directory (if it exists) for:
   - `require(` calls (should be ESM `import` instead)
   - Dynamic `import()` expressions (should be static imports)
   - Report file paths and line numbers

7. **License compliance** — For each dependency, check its license field in `node_modules/<pkg>/package.json` or via `npm view <pkg> license`. Flag:
   - Packages with no license specified
   - Copyleft licenses (GPL, AGPL, LGPL) that may conflict with project licensing
   - Unknown or uncommon licenses that need manual review

8. **Generate report** — Output a structured markdown report to the console (do NOT write to a file):

   ```markdown
   # Dependency Audit Report

   **Date**: YYYY-MM-DD
   **Project**: <name from package.json>
   **Total dependencies**: N (M dev)

   ## Version Pinning (Rule 3.4)
   - [ ] All versions pinned to exact — N issues found
   | Package | Type | Current | Issue |
   |---------|------|---------|-------|

   ## Unnecessary Dependencies
   - [ ] No replaceable dependencies — N issues found
   | Package | Built-in Alternative | Notes |
   |---------|---------------------|-------|

   ## Security Vulnerabilities
   - [ ] No known vulnerabilities — N issues found
   | Package | Severity | Advisory |
   |---------|----------|----------|

   ## Dynamic Imports (Rule 3.4)
   - [ ] All imports are static ESM — N issues found
   | File | Line | Issue |
   |------|------|-------|

   ## License Compliance
   - [ ] All licenses compatible — N issues found
   | Package | License | Issue |
   |---------|---------|-------|

   ## Summary
   - Total issues: N
   - Critical: N | High: N | Medium: N | Low: N
   ```

9. **Do not fix anything** — This is an audit only. Suggest the user run `/project-init` to fix configuration issues or manually update `package.json` for pinning issues.