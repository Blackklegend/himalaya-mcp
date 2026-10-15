# Security review and hardening record

Date: 2026-10-15 (America/Sao_Paulo). Fork version: `2.1.2-hardened.1`.
Scope selected by the owner: read-only defaults and explicit opt-ins, **preview-only
drafts with delivery disabled**, filesystem/header/MML hardening, reproducible
manual activation, and mocked regression tests. See HARDENING.md for operation
and UPSTREAM.md for source provenance.

## Findings and disposition

| Finding in the reviewed 2.1.2/source formula | Disposition in this branch |
| --- | --- |
| First-call `confirm=true` sends without a mandatory preview or independent human approval | Both compose handlers reject it. The underlying `sendTemplate` is a permanent refusal; shared execution and its single-attempt seam reject delivery commands. All-capability protocol tests verify no send command reaches the synthetic CLI. |
| Arbitrary process-readable attachment paths | Local references require an operator-configured dedicated root and `attachments`; canonical containment, regular-file/link checks, path restrictions, count and per-file size limits are tested on actual temporary files. |
| MML injection through paths, filenames, body, or raw template | User MML directives are rejected; canonical and supplied attachment paths must fit the restricted MML representation. This is a deliberately restricted preview format, not a complete MML escaping implementation. |
| CR/LF header injection in subject/CC/BCC | All structured header values, including the configured sender, reject controls and line separators. Tests cover CR, LF, CRLF, NUL and Unicode separators in every input header field. |
| Unrestricted action-item destination silently overwrites files | Optional file output needs `export`, a dedicated root and a flat filename. Exclusive/no-follow creation with mode 0600 prevents overwrite and reports failure. Text output remains available without filesystem permission. |
| Pre-send hook prints incomplete previews and exits successfully | The hook blocks delivery attempts, fails closed for malformed input, and does not persist recipient/subject/body logs. Server/client enforcement works without the plugin hook. |
| All tools registered by default | Exactly 12 read tools are exposed by default. Explicit capability mapping filters registration; new unclassified tools fail closed. Real protocol tests call hidden tool names directly and verify refusal. |
| External Homebrew helper activates potentially different marketplace content | The external tap is unchanged. This fork's documented path builds a reviewed checkout and prints canonical local configuration. No marketplace command or settings edit is involved. The server path has no installed-plugin or moving-opt fallback. |
| Raw read puts message ID in a filesystem path, bypasses shared validation, and drops folder selection | Fixed internal filename for v1; ID/control/path validation and shared account/folder handling; v2 raw reads use stdout. Regression tests verify traversal rejection, folder/account routing and cleanup. |
| v1 normal reads and export paths can set Seen | Normal reads use `--preview`. v1 HTML/raw exports require the explicit `mailbox-write` grant as well as `attachments`. V2.0.0 IMAP read source uses BODY.PEEK. |
| Downloaded path was deleted before being returned; temporary output could leak on failure | Successful requested downloads retain their private directory; listing/extraction/failure paths clean up. Tests use actual temporary files. Inbound parts are checked with `lstat` and size/count checks after download. |
| Legacy snooze file rewrite bypasses the constrained export scheme | Both snooze tools remain unavailable even when all supported capabilities are enabled. |
| Known advisories in the original dependency lockfile | Compatible runtime updates and a Vitest 4 patch applied. Runtime audit reports zero known advisories. Remaining development packaging advisories are described below. |

Capability grants such as `mailbox-write`, `calendar` and `reminders` authorize those
classes of operations. They do not prove a human approved an individual action.
No delivery approval mechanism has been implemented or simulated by a model token.

## Verification

- `npm run lint` / `npm run build`: TypeScript compilation.
- `npm test`: complete Vitest suite through an isolated test launcher. The launcher
  uses a disposable home/config, a fake Himalaya executable and guards for unmocked
  desktop commands. Integration tests create synthetic subprocesses; delivery is
  always mocked or rejected. Existing tests that expected delivery were replaced
  with refusal/preview regressions rather than skipped.
- `tests/security-protocol.test.ts`: actual MCP client/server stdio, default tool
  list, invocation of hidden tool names, full-capability send refusal before and
  after preview, and canonical manual configuration output.
- `tests/security.test.ts`, `compose*.test.ts`, `read-raw.test.ts`, and
  `attachment-boundary.test.ts`: filesystem escapes, links, overwrite refusal,
  header/MML injection, unsafe raw IDs, attachment retention/cleanup and internal
  client bypass attempts.
- Tagged fake-CLI tests ensure the v1 non-mutating read flag reaches the process
  boundary. Other original unit/integration tests remain in the suite.
- `npm run build:bundle`: rebuilds both server/plugin bundles from this source and
  lockfile. Their SHA-256 values are compared after final validation. No distributed
  upstream binary was used as the hardened build.
- `npm audit --omit=dev --json`: zero runtime advisory matches after patching.
  `npm audit --json`: two high development entries, `node-forge` and the dependent
  `@anthropic-ai/mcpb`; npm reports no available fix. An audit result is not a source
  code audit, proof of exploitability, or a promise that future advisories will not
  be discovered.

The original full suite yielded 717/718 passing under the first isolation attempt;
one assertion expected the binary name `himalaya` while the launcher forced an
absolute fake path. The completed isolation launcher uses a fake executable named
`himalaya` on PATH, preserving that assertion while avoiding the real CLI.

Validation host: macOS, Node.js v24.18.0, npm 12.0.2. Node 22 remains the declared
minimum; this run did not separately test every Node version or operating system.
Final test count and artifact hashes are recorded below after the last build.

## Dependency advisory context

The original runtime audit matched six packages: MCP SDK, fast-uri, Hono,
ip-address, proxy-addr and qs. The locked SDK moved from 1.30.0 to 1.32.1;
compatible transitive fixes were applied. Vitest and coverage moved from 4.1.10
to 4.1.11. The package declares the exact reviewed SDK/test versions and the
lockfile fixes the complete dependency graph.

The [SDK advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)
explicitly excludes MCP servers and stdio clients; it concerns OAuth clients over
HTTP. It was a dependency match here, not demonstrated credential exfiltration
from this application. The [proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
concerns proxy IP trust handling; this application exposes no HTTP listener.
The affected packages were still updated.

The remaining [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
is in the development MCPB toolchain. The email server does not import that
packaging tool. CI gates runtime advisories explicitly; the remaining development
packaging findings remain a documented exception. CI installs with lifecycle
scripts disabled, and packaging uses only the locally locked MCPB executable. This iteration uses source builds and creates no signed release;
it does not certify the packaging tool or its certificate verification.

## Relevant CLI source checks

These targeted checks establish the read-mode choices; they are not a full CLI audit:

- [v1.1.0 read](https://github.com/pimalaya/himalaya/blob/v1.1.0/src/email/message/command/read.rs)
  chooses `peek_messages` only with preview enabled.
- [v1.1.0 export](https://github.com/pimalaya/himalaya/blob/v1.1.0/src/email/message/command/export.rs)
  uses `get_messages`.
- [v2.0.0 IMAP backend](https://github.com/pimalaya/himalaya/blob/v2.0.0/src/imap/backend.rs)
  implements reads with BODY.PEEK.
- [v2.0.0 read](https://github.com/pimalaya/himalaya/blob/v2.0.0/src/shared/message/read.rs)
  supports raw stdout and refuses combining it with JSON output.

## Remaining limitations

The application, CLI, client and OS remain separate trust boundaries. No real
mailbox, IMAP/SMTP server, authentication provider, or distributed binary was
connected or audited. No application/client integration was installed or activated;
no real email was sent and no release was published. The GitHub fork and review
branch are source artifacts.

The underlying CLI runs with the server process's filesystem/network permissions
and may execute configured authentication commands. Private temporary directories
and checks after download do not sandbox the CLI's writes or impose disk limits
while it downloads. Another process with the same user's privileges can modify
source/configuration or race filesystem access. The root checks do not defend
against a compromised macOS account.

The header/address checks intentionally support a restricted subset; they are not
an RFC-complete email parser. V2 HTML export is unavailable. CLI minor versions,
backends other than the inspected paths, every dependency's implementation, and
all plugin skill/agent instructions have not received an exhaustive audit. Legacy
upstream documentation is retained with a prominent fork-specific notice.

Read-only access still returns sensitive mailbox data to the MCP client and model.
Email can contain prompt injection; other tools available to the model can create
separate exfiltration paths. This fork does not establish employer permission to
process workplace email or certify it for a work mailbox. Deploying it should be
a separate decision based on the client's data handling, the CLI/configuration,
and the actual permissions granted.

## Final validation record

- Full suite: **767 passed, 44 test files**, Vitest 4.1.11, 14.55 seconds.
- TypeScript lint/build and `git diff --check`: passed.
- Rebuilt root and plugin bundles: real stdio smoke tests passed for both default
  (12 tools) and drafts (15 tools), including delivery refusal with a deliberately
  nonexistent CLI binary.
- Runtime advisory counts: zero at all severities. Complete audit: two high
  development entries with no available fix, as described above.
- SHA-256 `package-lock.json`:
  `111819fdee1a57785225317746effa95a55f4493ad74969b729d069f5dadb7e9`.
- SHA-256 of each rebuilt server bundle (`dist/index.js` and
  `himalaya-mcp-plugin/dist/index.js`):
  `1be5c2ac336c5eb44f49b5e76a801477b613154f7ab6dff41b31454590add1c2`.

These hashes identify this local build on the recorded toolchain. The Git commit
containing this record identifies the reviewable source; they do not attest an
upstream release or an independently reproducible binary across all toolchains.
