---
name: adr
description: Create an Architecture Decision Record (ADR) following the project coding standard (Rule 10.2)
disable-model-invocation: true
arguments:
  - name: title
    description: Short title for the ADR (e.g., "Use Result pattern for error handling")
    required: true
---

# Create Architecture Decision Record

You are creating a new ADR for this project. ADRs document significant design decisions per Rule 10.2 of the coding standard.

## Instructions

1. **Locate existing ADRs** — Search for `docs/adr/` in the project root. List existing ADR files to determine the next sequence number (e.g., if `0003-*.md` exists, the next is `0004`). If the directory does not exist, create `docs/adr/`.

2. **Load the coding standard** (optional reference) — Check if the file at `documents/TypeScript Coding Standard for Mission-Critical Systems.md` exists relative to the project root. If it does, use it as context for the decision. If not, proceed without it.

3. **Read the ADR template** — Read the template at `.claude/skills/adr/templates/adr-template.md` (relative to project root).

4. **Gather decision details** — Ask the user the following questions (skip any already provided via `$ARGUMENTS`):
   - What is the context or problem being addressed?
   - What alternatives were considered?
   - What is the decision?
   - What are the consequences (positive, negative, risks)?

5. **Generate the ADR** — Fill in the template with the user's answers:
   - **Filename**: `docs/adr/NNNN-<kebab-case-title>.md` (e.g., `docs/adr/0004-use-result-pattern.md`)
   - **Status**: `Proposed` (default)
   - **Date**: today's date in ISO format
   - Replace all `${VARIABLE}` placeholders with actual content

6. **Update the ADR index** — If `docs/adr/README.md` exists, append the new ADR to the table. If it does not exist, create it with a table header and the new entry:

   ```markdown
   # Architecture Decision Records

   | Number | Title | Status | Date |
   |--------|-------|--------|------|
   | NNNN   | Title | Status | Date |
   ```

7. **Confirm** — Show the user the created file path and a summary of the decision.

## Title from arguments

The ADR title is: **$ARGUMENTS**