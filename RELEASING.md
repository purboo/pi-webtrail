# Publishing pi-webtrail

The GitHub workflow `.github/workflows/publish.yml` supports npm Trusted Publishing (OIDC). It needs no npm token in GitHub Secrets or on the maintainer's machine.

## One-time npm setup

The package must exist on npm before its trusted publisher can be configured. For the first version, publish using an authenticated npm session, or create the package through npm's staged-publishing flow and complete the required approval. This repository's workflow cannot bootstrap npm ownership by itself.

In the package's npm settings, add a GitHub Actions trusted publisher with:

| Field | Value |
| --- | --- |
| Organization or user | `purboo` |
| Repository | `pi-webtrail` |
| Workflow filename | `publish.yml` |
| Environment name | Leave blank |
| Allowed actions | Enable direct publishing with `npm publish` |

New configurations allow staging by default. Direct `npm publish` must be explicitly allowed to publish without a separate human approval for every version. Configuring or changing trust still requires npm account authentication and 2FA. Each npm package has its own trust configuration.

Complete the first successful OIDC publish within 48 hours of creating the trust configuration; otherwise, recreate the expired configuration.

## Publish a version

Commit the new version in `package.json` and `package-lock.json`, then push a matching stable tag such as `v0.1.1`. The workflow checks the tag and package version, runs tests and the dependency audit, and publishes directly with provenance.

To publish an existing tag, use **Actions → Publish → Run workflow** on `main` and enter the tag. This is useful for `v0.1.0`, whose tag predates the publishing workflow. Once npm trust is configured, the CLI equivalent is:

```sh
gh workflow run publish.yml --repo purboo/pi-webtrail --ref main -f tag=v0.1.0
```

This workflow uses GitHub-hosted runners and Node.js 24. It does not publish from pull requests and does not read an npm publishing token.

## npm policy references

- [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [Access tokens and the January 2027 direct-publishing transition](https://docs.npmjs.com/about-access-tokens/)

A local granular token with write permission and Bypass 2FA can currently automate direct publishing, subject to package policy. It is a temporary alternative: write tokens expire within 90 days, and npm is retiring direct publishing through bypass-2FA tokens in January 2027.
