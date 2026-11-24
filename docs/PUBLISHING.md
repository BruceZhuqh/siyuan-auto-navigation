# Publishing

1. Create a public GitHub repository named `siyuan-auto-navigation`, default branch `main`, under the confirmed author account.
2. Run `python tools/configure.py --owner ACCOUNT` and commit source, manifest and assets. Inspect `git status` before pushing.
3. Run `npm test` and `python tools/build.py`. Review the ZIP root and preview. The build refuses an empty repository URL.
4. Create a non-draft GitHub Release `v1.0.0` and upload `release/package.zip` as the asset named exactly `package.zip`.
5. Fork `siyuan-note/bazaar`; read its current AGENTS.md and PR template before editing. Create branch `add-plugin-siyuan-auto-navigation` from current `main`.
6. Only append `ACCOUNT/siyuan-auto-navigation` to `plugins.txt`, preserving LF, and submit PR `Add ACCOUNT/siyuan-auto-navigation`. One package per PR; the separate widget is not part of this submission.
7. Confirm authorship/authorization, redistribution permission and original or authorized assets in the PR. This repository is open source under MIT.
8. Resolve CI or reviewer feedback on the same PR. Market availability requires maintainer approval and merge; submitting a PR is not the same as being listed.

Official sources: https://github.com/siyuan-note/bazaar/blob/main/README.zh-CN.md and https://github.com/siyuan-note/plugin-sample/blob/main/README.zh-CN.md.
