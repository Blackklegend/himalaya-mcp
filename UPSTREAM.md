# Upstream provenance and attribution

- Original project: https://github.com/Data-Wise/himalaya-mcp
- Original author declaration: Data-Wise (`package.json`), preserved.
- Original license declaration: MIT (`package.json`), preserved. The reviewed
  upstream Git tree did not include a standalone LICENSE file; none has been
  invented or replaced by this fork.
- Reviewed release tag: `v2.1.2`, commit
  `ee97d4e69d6c59c6461ac4f97dbcea98696fa79a`.
- Feature branch base: upstream `dev`, commit
  `8e759a9` (full hash available through Git). Its source, tests, package files,
  lockfile, and repository instructions matched the reviewed tag; differences
  from the tag were documentation/status only.
- Fork: https://github.com/Blackklegend/himalaya-mcp
- Fork version: `2.1.2-hardened.1`.

Original history and upstream documentation are retained. README.md identifies
which installation/sending claims apply only to the original project. The fork's
HARDENING.md and SECURITY-REVIEW.md describe its changed behavior. No upstream
maintainer endorsement is implied.

Original ZIP reviewed locally:

```text
himalaya-mcp-2.1.2.zip
SHA-256 ef4c772bc7af4b49d0680ad2902a606d27fc0de375ea9ee5580b0ab51ece87ad
```

The separately inspected local Homebrew formula was revision 2, targeting the
upstream v2.1.2 tarball with its declared SHA-256
`81e273ad3f39764d43418d3afbb1fde9e9184af73e596468207ff1ca235854b7`.
The formula file itself had SHA-256
`164b293d55fa3725c542ef078dd1a1c0357f2c873644e1715dad454650212a4f`.
Neither the tap nor the installed formula was modified by this work.
