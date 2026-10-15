# Hardened fork: 2.1.2-hardened.1

This fork preserves Data-Wise's implementation and attribution. Its intended initial
profile is **read-only mailbox access, with delivery completely disabled**. It has
not been connected to a real mailbox during preparation. It is not a full audit of
Himalaya, dependencies, binaries, or the MCP client.

## Default behavior

Without `HIMALAYA_CAPABILITIES`, only these 12 tools are registered:

- `list_emails`, `search_emails`, `read_email`, `get_unread_count`
- `list_starred`, `list_folders`, `list_threads`, `read_thread`
- `render_email`, `export_to_markdown`, `create_action_item`, `health_check`

`export_to_markdown` and `create_action_item` return text. Supplying `destination`
to `create_action_item` requires a separate export capability and configured root.
`render_email` uses the text read path by default. All three resources and seven
prompts remain available. A resource message read uses the same protected client.

Himalaya v1 reads always include `--preview`, avoiding its default Seen mutation.
Tagged v2.0.0 IMAP reads use BODY.PEEK internally. Unknown major versions above 2
are refused. Backend behavior outside the inspected paths remains a CLI trust
boundary, rather than an OS-enforced read-only guarantee.

If `HIMALAYA_ACCOUNT` is configured, per-call account changes are rejected and
health probes are restricted to that account. Without it, configured accounts
remain accessible. Use a dedicated Himalaya configuration with only the intended
account when isolating work mail.

## Explicit capabilities

Set a comma-separated `HIMALAYA_CAPABILITIES` in the operator-controlled server
environment. Unknown values fail startup. Tool arguments cannot grant permissions.

| Capability | Effect |
| --- | --- |
| `drafts` | Registers `draft_reply`, `compose_email`, and `send_email`. All are preview-only. |
| `mailbox-write` | Enables flags, moves, folder creation and deletion. This is a standing grant, not per-call human approval. |
| `attachments` | Enables attachment listing/download, calendar extraction, raw/HTML reads, and local attachment metadata in previews. Downloads write private temporary directories. |
| `export` | Allows action-item output to a new file under `HIMALAYA_EXPORT_ROOT`. No additional tool is registered. |
| `clipboard` | Allows writing the system clipboard. |
| `calendar` | Allows Apple Calendar event creation. The legacy confirmation argument is not proof of human approval. |
| `reminders` | Allows Apple Reminders creation. |

There is **no send capability**. Every `confirm=true` compose/send call fails,
including the first call and calls made after a preview. `HimalayaClient.sendTemplate`
throws without starting a subprocess; generic client execution rejects delivery
commands. The pre-send plugin hook is defense in depth, blocks delivery attempts,
and does not log message contents or claim to authenticate human approval.

Snooze tools are unavailable in this iteration because their legacy storage
unconditionally rewrites a path under the user's home. The upstream tool catalog
and extension manifest are historical supersets, not the live default tool list.
The live `tools/list` response is authoritative.

## Draft and filesystem constraints

Draft bodies are plain text. Active MML (`<#...`) and NUL are refused. Header
fields reject CR, LF, controls, and Unicode line separators. Structured recipients
must be comma-separated plain addresses; display-name forms are intentionally
outside this initial implementation. Raw preview templates accept a restricted,
unfolded, nonduplicated header set. The full template, including Bcc, is displayed
when previewing. None of this validation grants permission to deliver.

Local preview attachments require both `attachments` and an existing absolute
`HIMALAYA_ATTACHMENT_ROOT`. The directory must be owned by the current user and
not writable by other users. Files must resolve beneath it, be regular files with
one link, at most 10 MiB each, and have paths safe for the restricted MML output.
Final-component symlinks, canonical escapes, and ambiguous path characters are
refused. At most ten attachment references are accepted. Previews reference paths;
they are not immutable attachment snapshots and cannot be sent by this fork.

File exports require `export` and an existing absolute `HIMALAYA_EXPORT_ROOT`
with the same ownership restrictions. `destination` is a plain filename in this
flat directory. Exclusive creation plus no-follow prevents overwriting existing
files or final symlinks. New files have mode 0600; errors are reported.

Inbound attachments use private `mkdtemp` directories. After the CLI finishes,
symlinks, hardlinks, nonregular files, more than 50 parts, individual parts over
10 MiB, and totals over 25 MiB are refused. Failure/listing/extraction paths clean
up their temporary output. A successful `download_attachment` retains its private
directory so the returned path remains usable; remove that directory when finished.
The CLI downloads all parts. Its own filename handling and disk usage *during*
download are not confined by these post-download checks.

Himalaya v1 HTML/raw exports, reply templates, and attachment downloads can set
Seen and therefore additionally require `mailbox-write`. This includes attachment
listing and calendar extraction, which download parts internally. Raw export uses
a fixed `message.eml` filename and the shared
client, honoring folder/account validation and timeouts. V2 raw reads use stdout
without the JSON flag. V2 HTML export is unavailable in this iteration; rendering
falls back to text. File readers refuse symlinks/nonregular/oversized files.

## Build and review without activation

Use the exact reviewed commit in a dedicated, versioned checkout and keep its
source and lockfile together. Do not point an active client at a mutable development
checkout, `main`, a moving Homebrew `opt` symlink, or an upstream marketplace entry.
These commands build/test local artifacts and print configuration; they do not
connect a mailbox or install/activate a client integration:

```sh
npm ci --ignore-scripts
npm run build
npm run build:bundle
npm test
node dist/cli/index.js config
```

`config` prints JSON with an absolute Node executable, the canonical server path
in this exact build, and an empty capability set. It does not edit settings,
register a marketplace, install/update a plugin, or start the email server. Running
the CLI with no arguments prints help. `setup` and extension commands are legacy,
explicit activation commands and are not part of this preparation workflow.

Record the reviewed Git commit and SHA-256 of `package-lock.json`,
`dist/index.js`, and `himalaya-mcp-plugin/dist/index.js`. Both server bundles must
match after `build:bundle`. If making a deployment copy, build first, verify it,
then keep that reviewed directory unchanged. Pin/review the separate Himalaya
binary and its account configuration too. Manual client configuration/activation
is a later human action. No fork Homebrew formula or release is published here.
The existing upstream tap/formula was inspected and left unchanged.

The original helper is external to this repository. Avoid
`himalaya-mcp-install` and upstream marketplace install/update commands for this
fork: they may activate upstream content. `findServerEntry` no longer falls back
to another installed plugin or a moving Homebrew `opt` path. Upstream release,
docs deployment, and aggregator-sync workflows are retained as `.yml.disabled`;
they cannot run as GitHub Actions workflows in this branch.

## Verification and trust limits

`npm test` runs Vitest in a disposable home with a fake Himalaya command and guards
against unmocked Apple/clipboard/client operations. Protocol tests launch the
server over real stdio using a synthetic CLI. No test needs mailbox credentials or
real delivery. Unit tests that exercise opt-in writes mock their subprocesses.

Runtime dependency advisories are tracked with `npm audit --omit=dev`; this is
advisory matching, not a dependency source audit. See SECURITY-REVIEW.md for the
recorded result and remaining development-tool advisories.

Email bodies, headers, HTML, and attachments are untrusted content. They can carry
prompt injection. Read-only tools can still disclose mailbox contents to the MCP
client and its model provider. The server cannot prevent another tool available
to that model from exfiltrating data. Capabilities control this server's exposed
operations, not all processes running under the same macOS user. A compromised
CLI, writable source/dependency tree, malicious operator configuration, or another
process with the same user's privileges can defeat application-level controls.
Himalaya may execute configured authentication commands and keep local caches.

Any future sending design needs a trusted client or separate human-controlled
approval channel, with exact content, recipients, account, and attachment bytes
bound to that approval. A token issued only to the model does not establish human
authorization. Sending is deliberately absent from this iteration.
