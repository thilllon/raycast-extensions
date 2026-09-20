# raycast-extensions

## Development setup

Install [mise](https://mise.jdx.dev/getting-started.html), then run:

```sh
mise trust
mise install
```

`mise.toml` pins Node.js, pnpm, Gitleaks, and Lefthook. `mise install` also
installs the Git hooks for this checkout. Keep `mise` available on your `PATH`
when using Git, including from a GUI client.

## Secret scanning

- Every commit scans staged changes with Gitleaks.
- Every push scans the full Git history across all local branches, remote-tracking
  branches, and tags, including secrets removed in later commits.
- A finding blocks the commit or push. Secret values are redacted in scan output.

`.gitleaksignore` records two verified historical Chrome extension public-key
false positives by exact finding fingerprint. New findings are still scanned.

Run the checks manually or reinstall hooks:

```sh
mise run secrets:staged
mise run secrets
mise run hooks:install
```

Git hooks are local to each checkout, so run the setup commands after cloning.
