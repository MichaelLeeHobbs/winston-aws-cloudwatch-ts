---
name: project-docs
description: Scaffold standard project documentation files (README, LICENSE, CONTRIBUTING, etc.)
disable-model-invocation: true
arguments:
  - name: docs
    description: "Comma-separated list of docs to generate (e.g., 'readme,license,contributing'). If omitted, you will be asked."
    required: false
---

# Scaffold Project Documentation

You are generating standard project documentation files for this repository.

## Available Documents

The following documents can be generated:

| Key              | File                  | Description                                          |
|------------------|-----------------------|------------------------------------------------------|
| `readme`         | `README.md`           | Project overview, setup, usage, and contribution info |
| `license`        | `LICENSE`             | Open source license file                             |
| `contributing`   | `CONTRIBUTING.md`     | Contribution guidelines and development workflow     |
| `changelog`      | `CHANGELOG.md`        | Version history following Keep a Changelog format    |
| `adr`            | `docs/adr/README.md`  | ADR index and initial template (Rule 10.2)           |
| `gitignore`      | `.gitignore`          | Git ignore patterns for Node.js/TypeScript projects  |
| `security`       | `SECURITY.md`         | Security vulnerability reporting policy              |
| `code-of-conduct`| `CODE_OF_CONDUCT.md`  | Contributor Covenant code of conduct                 |

## Instructions

1. **Determine which docs to create** — If `$ARGUMENTS` is provided, parse it as a comma-separated list of keys from the table above. Otherwise, ask the user which documents they want using a multi-select question with all options listed above.

2. **Check for existing files** — For each selected document, check if the file already exists. If it does, ask the user whether to overwrite or skip it.

3. **Read project context** — Examine the following to tailor the generated docs:
   - `package.json` (project name, description, version, license, scripts)
   - `CLAUDE.md` (project overview)
   - `documents/TypeScript Coding Standard for Mission-Critical Systems.md` (if present, reference it in CONTRIBUTING.md)
   - Existing `README.md` or other docs (to avoid contradictions)

4. **Generate each document** — Create each file with appropriate content:

   - **README.md**: Include project name, badges placeholder, description, features, prerequisites, installation, usage, development (build/test/lint scripts from package.json), project structure, contributing link, license link.
   - **LICENSE**: Ask the user which license (MIT, Apache-2.0, ISC, BSD-3-Clause). Default to MIT if not specified.
   - **CONTRIBUTING.md**: Development setup, coding standards reference (link to the coding standard doc if it exists), PR process, commit message conventions, testing requirements (Rule 9.1: >=95% branch coverage).
   - **CHANGELOG.md**: Follow [Keep a Changelog](https://keepachangelog.com/) format. Start with `## [Unreleased]` section.
   - **ADR index**: Create `docs/adr/README.md` with an empty table. Create the `docs/adr/` directory if needed.
   - **.gitignore**: Node.js + TypeScript patterns (node_modules, dist, coverage, .env, *.js.map, etc.).
   - **SECURITY.md**: Vulnerability reporting instructions, supported versions table, disclosure policy.
   - **CODE_OF_CONDUCT.md**: Contributor Covenant v2.1.

5. **Summary** — List all files created and any that were skipped.