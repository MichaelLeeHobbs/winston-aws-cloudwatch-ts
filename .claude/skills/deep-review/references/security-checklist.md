# Security Review Checklist — Mission-Critical TypeScript

Focused security checklist based on OWASP Top 10 and coding standard Rules 7.2, 7.4.

## Input Validation (Rule 7.2)

- [ ] **All external inputs validated** — API bodies, query params, headers, env vars, file contents
- [ ] **Schema validation at boundaries** — Zod, Valibot, or equivalent used at every entry point
- [ ] **Length limits enforced** — String inputs have min/max length constraints
- [ ] **Numeric ranges checked** — Numbers validated for min/max, integer vs. float
- [ ] **Type coercion avoided** — No implicit string-to-number or similar conversions
- [ ] **Allowlists over denylists** — Validation accepts known-good patterns, not blocks known-bad

## Injection Prevention (OWASP A03)

- [ ] **SQL injection** — Parameterized queries only; no string concatenation in SQL
- [ ] **NoSQL injection** — User input not passed directly to MongoDB operators ($gt, $regex, etc.)
- [ ] **Command injection** — No `child_process.exec()` with user input; use `execFile` with argument arrays
- [ ] **XSS prevention** — Output encoding/escaping in HTML contexts; CSP headers set
- [ ] **Path traversal** — File paths validated; no `../` or user-controlled paths to `fs` operations
- [ ] **Template injection** — No user input in template strings evaluated by template engines
- [ ] **LDAP/XML injection** — Input sanitized before passing to LDAP queries or XML parsers

## Authentication & Authorization (OWASP A01, A07)

- [ ] **No hardcoded credentials** — Secrets from env vars or vault only
- [ ] **Password hashing** — bcrypt, scrypt, or Argon2 (never MD5, SHA-1, or plain SHA-256)
- [ ] **Session management** — Secure cookies (HttpOnly, Secure, SameSite)
- [ ] **Token validation** — JWTs verified with proper algorithm pinning (no `alg: none`)
- [ ] **Authorization checks** — Every endpoint verifies user permissions (not just authentication)
- [ ] **Rate limiting** — Login and sensitive endpoints rate-limited

## Cryptography (Rule 7.4)

- [ ] **Audited libraries only** — Node.js `crypto` module or `libsodium.js`
- [ ] **No custom crypto** — No hand-rolled encryption, hashing, or PRNG
- [ ] **Secure random** — `crypto.randomBytes()` or `crypto.randomUUID()` for random values
- [ ] **Key management** — Keys never in source code; rotated periodically
- [ ] **TLS/HTTPS** — All external communications over TLS 1.2+

## Secrets & Data Exposure (OWASP A02, OWASP A04)

- [ ] **No secrets in code** — `.env`, API keys, passwords, tokens not in source files
- [ ] **No secrets in logs** — Logging does not include passwords, tokens, or PII
- [ ] **No secrets in errors** — Error messages don't leak internal paths, stack traces, or config
- [ ] **.gitignore coverage** — `.env`, `*.pem`, `*.key`, credentials files excluded from git
- [ ] **Sensitive data encrypted at rest** — PII, financial data encrypted in databases
- [ ] **Minimal data exposure** — APIs return only necessary fields (no full objects)

## HTTP Security (Rule 7.4)

- [ ] **CORS configured** — Not `*` in production; specific origin allowlist
- [ ] **Security headers set**:
  - Content-Security-Policy
  - Strict-Transport-Security (HSTS)
  - X-Content-Type-Options: nosniff
  - X-Frame-Options: DENY or SAMEORIGIN
  - Referrer-Policy
- [ ] **CSRF protection** — Tokens or SameSite cookies for state-changing operations
- [ ] **Request size limits** — Body parser limits configured to prevent DoS

## Dependency Security (Rule 3.4)

- [ ] **npm audit clean** — No known vulnerabilities in dependencies
- [ ] **Pinned versions** — Exact versions prevent supply chain attacks via malicious updates
- [ ] **Lock file committed** — `package-lock.json` in version control
- [ ] **Minimal dependencies** — Each dep justified; Node.js built-ins preferred
- [ ] **No dynamic imports** — Static imports only; no `require()` with variables

## Error Handling & Logging (Rules 6.1, 6.3)

- [ ] **No stack traces to users** — Production errors return generic messages
- [ ] **Structured audit logging** — Security events logged with timestamp, actor, operation
- [ ] **Tamper-evident logs** — Append-only or cryptographically signed audit logs
- [ ] **Error handling doesn't leak** — Catch blocks don't expose internal state

## Async Security (Rules 4.1, 4.2, 4.3)

- [ ] **Timeouts on all I/O** — Prevents resource exhaustion from slow-loris attacks
- [ ] **Bounded parallelism** — Prevents memory exhaustion from parallel request floods
- [ ] **Graceful shutdown** — SIGTERM handler drains connections properly
- [ ] **No unhandled rejections** — All promises handled; uncaught rejection handler installed
