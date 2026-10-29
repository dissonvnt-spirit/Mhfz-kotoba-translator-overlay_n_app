# Pre-release security review — 2026-10-28

Scope: current application/API source and dependency manifests before the public
Windows x64 update. The scanner timestamp was 2026-10-29 UTC (2026-10-28 in
America/Chicago).

## Automated scan results

| Scanner | Status | Critical | High | Moderate | Low |
| --- | --- | --- | --- | --- | --- |
| Dependency audit (OSV) | Completed | 0 | 0 | 4 | 0 |
| Static application analysis | Completed, not marked incomplete | 0 | 0 | 0 | 0 |
| Privacy/security data-flow analysis | Completed | 0 | 0 | 0 | 0 |

Four dependency reports represent three distinct issues. These are **remaining
findings**, not fixed or suppressed results:

- **`block-buffer` 0.10.4 — GHSA-qwgh-2vcv-g2f7, moderate.** The advisory
  describes memory unsafety after a compression callback panics, the panic is
  caught, and the corrupted buffer is reused. In the Windows dependency tree
  this is pulled through `digest` → `sha2` → `tauri-codegen` →
  `tauri-macros`: a build-time dependency rather than the app's translation
  runtime. This narrows exposure; it is not proof of non-exploitability.
  The advisory points to the newer 0.12.1 line. Forcing that incompatible line
  into a parent expecting 0.10 is not a safe lockfile-only patch.
- **`glib` 0.18.5 — RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g,
  moderate (two reports for one issue).** Iterator unsoundness is fixed in
  0.20.0. This GTK/Linux dependency is absent from
  `cargo tree --locked --target x86_64-pc-windows-msvc -i glib`.
  It remains relevant if Linux support is built; this release targets Windows.
- **`proc-macro-error` 1.0.4 — RUSTSEC-2024-0370, moderate.** This is an
  unmaintained-dependency advisory, not an identified exploit in this app.
  It is absent from the Windows-target dependency tree. Replacing a transitive
  macro dependency without updating its upstream GTK consumer is not a safe
  direct substitution.

No broad framework replacement, unsafe dependency override, advisory suppression
or permission bypass was introduced to obtain a clean-looking report. Revisit
these findings when compatible upstream fixes become available.

## Publication boundaries

- Publish a product-only snapshot on the repository's existing history, not
  the Replit workspace's history.
- Exclude secrets, environment files, agent memory, uploaded screenshots,
  mockup work, dependency directories and generated binaries from source.
- Provider credentials stay on the server. Optional cloud translation requires
  player consent; the installer does not contain the operator's OpenAI key.
- Windows downloads remain unsigned. A SHA-256 manifest checks integrity
  against the release files; it does not replace publisher signing.
- Updating GitHub API source does not publish the hosted service or apply
  managed production database changes. Those remain owner-controlled.

These scans are point-in-time checks, not a guarantee of security or a substitute
for physical Windows/gameplay verification.
