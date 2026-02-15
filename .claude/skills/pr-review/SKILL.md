---
name: pr-review
description: Review a pull request diff against the mission-critical coding standard
disable-model-invocation: true
context: fork
agent: general-purpose
arguments:
  - name: pr
    description: "PR number or URL (e.g., '42' or 'owner/repo#42'). If omitted, reviews the current branch diff against main."
    required: false
---

# Pull Request Review

You are reviewing a pull request against the mission-critical TypeScript coding standard. Your review must be thorough, specific, and actionable.

## Dynamic Context

Fetch the PR data before starting the review. If `$ARGUMENTS` is provided, use it as the PR identifier. Otherwise, review the current branch diff against main.

### If a PR number/URL is provided:

Use the `gh` CLI to fetch:
- `!`gh pr view $ARGUMENTS --json title,body,baseRefName,headRefName,files,additions,deletions,author``
- `!`gh pr diff $ARGUMENTS``
- `!`gh pr checks $ARGUMENTS --json name,status,conclusion``
- `!`gh pr view $ARGUMENTS --json comments --jq '.comments[].body'``

### If no PR is provided (local branch diff):

Use git to get the diff:
- `!`git diff main...HEAD``
- `!`git log main..HEAD --oneline``

## Review Instructions

1. **Read the reference checklist** — Read `.claude/skills/pr-review/references/pr-review-checklist.md` for the full checklist.

2. **Load the coding standard** (optional) — Check if `documents/TypeScript Coding Standard for Mission-Critical Systems.md` exists. If present, use it for exact rule references. If absent, use the checklist as your primary reference.

3. **Analyze the diff** — For each changed file:
   - Identify the type of change (new file, modification, deletion, rename)
   - Check against every applicable shall-level rule
   - Note line numbers for specific findings

4. **Check for test coverage** — For every new or modified `.ts` file (not in `test/` or `__tests__/`):
   - Verify a corresponding `.test.ts` or `.spec.ts` file exists or was modified
   - Flag new functions/modules without test additions

5. **Check documentation** — Verify:
   - TSDoc on all new/modified public APIs (Rule 10.1)
   - CHANGELOG.md updated (if it exists)
   - ADR created for architectural decisions (Rule 10.2)

6. **Generate the review** — Output a structured review:

   ```markdown
   # PR Review: <title>

   **Branch**: <head> → <base>
   **Author**: <author>
   **Files changed**: N (+additions, -deletions)

   ## Summary
   <1-3 sentence summary of what the PR does>

   ## Findings

   ### Critical (must fix before merge)
   - [ ] `file.ts:42` — [Rule X.Y] Description of the violation

   ### Warnings (should fix)
   - [ ] `file.ts:15` — [Rule X.Y] Description of the concern

   ### Suggestions (nice to have)
   - [ ] `file.ts:88` — Suggestion for improvement

   ## Per-File Review

   ### `src/path/to/file.ts`
   - **Type**: new file / modified
   - **Findings**:
     - [ ] Line 12: ...
     - [ ] Line 45: ...
   - **Test coverage**: ✅ test file exists / ❌ no test file found

   ### `src/path/to/other.ts`
   ...

   ## Checklist
   - [ ] No `any` usage (Rule 3.2)
   - [ ] No traditional `enum` (Rule 3.5)
   - [ ] No `var` (Rule 5.2)
   - [ ] No recursion (Rule 8.2)
   - [ ] No `throw` for control flow (Rule 6.1)
   - [ ] Result pattern used for fallible operations (Rule 6.2)
   - [ ] All promises handled (Rule 4.1)
   - [ ] Async operations have timeouts (Rule 4.2)
   - [ ] Loops have upper bounds (Rule 8.1)
   - [ ] Exhaustive switch handling (Rule 8.3)
   - [ ] Immutability enforced (Rule 7.1)
   - [ ] External inputs validated (Rule 7.2)
   - [ ] Functions ≤ 40 lines, ≤ 4 params (Rule 8.4)
   - [ ] TSDoc on public APIs (Rule 10.1)
   - [ ] Dependencies pinned to exact versions (Rule 3.4)

   ## Verdict
   **✅ Approve** / **⚠️ Approve with comments** / **❌ Request changes**
   ```

7. **Do not push comments to GitHub** — Output the review to the console only. The user can copy findings to the PR if desired.
