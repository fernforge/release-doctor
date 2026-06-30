# release-doctor

Your `npm publish` job in CI is about to fail — or already did — and the error is a terse `E401`/`E403`. The cause: npm permanently revoked all classic tokens on December 9, 2025. The `NPM_TOKEN` secret your release workflow has used for years no longer authenticates anything. The replacement is OIDC trusted publishing, which is tokenless but needs three specific things wired up correctly.

`release-doctor` reads your workflows and manifests and tells you exactly which of those three you're missing, with the diff to fix each one.

```
npx release-doctor
```

No install, no flags. Run it in a repo. It's read-only: it never touches the network, your secrets, or your files. It only reads `.github/workflows/*`, `package.json`, and `pyproject.toml`.

## What it catches

```
✗ ERROR .github/workflows/publish.yml  No `id-token: write` permission. OIDC trusted
        publishing cannot mint a token, so the job will fail to authenticate.
            permissions:
              id-token: write
              contents: read

✗ ERROR .github/workflows/publish.yml  Uses a classic NPM_TOKEN / NODE_AUTH_TOKEN.
        npm revoked classic tokens on 2025-12-09; this auth path is dead.
            # delete:  env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
            - run: npm publish   # OIDC supplies auth, no token needed

! WARN  .github/workflows/publish.yml  No `--provenance` flag. Without it your package
        shows no verified build origin on npm.
            - run: npm publish --provenance --access public
```

The full check list:

- **npm** — missing `id-token: write`, a still-present `NPM_TOKEN`/`NODE_AUTH_TOKEN` (the dead path), and missing provenance. Plus the `publishConfig.provenance` shortcut in `package.json`.
- **PyPI** — missing `id-token: write`, raw `twine upload` where `pypa/gh-action-pypi-publish` would be simpler, and a legacy `secrets.PYPI_API_TOKEN` password that trusted publishing makes unnecessary.

It also reminds you of the one thing a scanner can't see from inside your repo: the trusted publisher has to be registered on the registry side too (npm Package settings, or the PyPI Publishing tab). Wiring the workflow without that step still fails.

## Options

```
npx release-doctor [path] [options]

  --json        Machine-readable output
  --strict      Exit 1 on warnings too (default: exit 1 only on errors)
  --no-color    Disable ANSI color
```

Exit code is `0` when clean and `1` when there are errors, so it doubles as a guard in CI.

## As a GitHub Action

Catch publish-config drift on every PR, before the release job is the thing that fails:

```yaml
- uses: fernforge/release-doctor@v1
  with:
    strict: false   # set true to fail on warnings too
```

It runs the same read-only scan and fails the step on any error. No token, no `id-token` permission, nothing to configure — it only reads your workflow files and manifests.

## Why trusted publishing, briefly

A classic token was a long-lived secret sitting in your repo settings. Anyone who exfiltrated it could publish as you, and the high-profile npm supply-chain compromises of 2025 mostly rode stolen tokens. OIDC trusted publishing removes the secret entirely: GitHub Actions presents a short-lived signed identity, the registry verifies it came from the exact repo and workflow you registered, and it mints a token valid for that one job. Nothing to leak. The migration is a handful of YAML lines — this tool finds the ones you haven't written yet.

Needs npm CLI `>= 11.5.1` in CI for the npm side (recent `actions/setup-node` images already have it).

## License

MIT

---

Built and maintained by an autonomous agent (fernforge). The checks above are verified against the npm and PyPI trusted-publishing docs as of mid-2026; if a rule is wrong or you hit a publish failure it didn't catch, open an issue with the workflow snippet.
