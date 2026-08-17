# Releasing

The package is `@adam91holt/grokbot-sdk`. It is published from `sdk/`.

Auth is npm **Trusted Publishing** (OIDC) from GitHub Actions, so no npm token is
stored in the repo. The first publish is the exception — see below.

## One-time setup

### 1. First publish, from your machine

Trusted publishing can only be configured on a package that already exists on the
registry, so the first version has to be published with a login.

```bash
npm login
cd sdk
npm publish
```

`publishConfig.access` is `public`, so the scoped package publishes publicly
rather than failing on a paid-plan check. `prepublishOnly` runs `npm run build &&
npm test` first, so a missing or stale `dist/` cannot ship.

### 2. Register the trusted publisher

On npmjs.com → the package → **Settings** → **Trusted Publisher** → GitHub Actions:

| Field | Value |
| --- | --- |
| Organization / user | `adam91holt` |
| Repository | `grokbot-sdk` |
| Workflow filename | `release.yml` |
| Environment | *(leave blank)* |

After this, CI can publish and you can revoke any local automation tokens.

## Every release after that

```bash
# 1. bump the version in sdk/package.json
cd sdk && npm version patch --no-git-tag-version   # or minor / major

# 2. commit the bump
cd .. && git add sdk/package.json && git commit -m "Release v0.1.1"
git push

# 3. tag and push the tag — this is what triggers the publish
git tag v0.1.1
git push origin v0.1.1
```

`.github/workflows/release.yml` then runs on the tag: it upgrades npm (trusted
publishing needs >= 11.5.1), installs, **verifies the tag matches
`sdk/package.json`**, tests, builds, publishes with provenance, and finally
creates a **GitHub Release** for the tag with generated notes and the npm
tarball attached.

The GitHub Release is created *after* `npm publish` succeeds, so a failed
publish never leaves a release announcing a version that is not on the
registry.

The tag must match the version. Tag `v0.1.1` against a `package.json` still
saying `0.1.0` fails the workflow before it reaches `npm publish`.

## Notes

- `dist/` is gitignored. It is built during publish, never committed.
- `files` ships `dist`, `src`, `README.md`, and `LICENSE`. `src` is included so
  the `.js.map` / `.d.ts.map` sourcemaps resolve.
- `sdk/LICENSE` is a copy of the repo-root `LICENSE`. npm only picks up a licence
  file next to the `package.json` being published, so keep the two in sync.
- Never add `NODE_AUTH_TOKEN` to `release.yml`. If npm sees a token it prefers it
  over OIDC and the publish loses its provenance attestation.
- `sdk.yml` runs tests and the build on every push and PR. `release.yml` only
  runs on `v*` tags.
