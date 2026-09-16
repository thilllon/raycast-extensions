# raycast-extensions

Personal Raycast extensions. Each folder is a standalone extension with its own `package.json`.

| Extension | What it does |
| --- | --- |
| [chrome-tabs-assemble](./chrome-tabs-assemble) | Move all Chrome tabs from every window into the frontmost window, keeping pinned tabs and tab groups |

## Developing an extension

Node and pnpm versions come from `mise.toml` at the repo root.

```sh
mise install   # node + pnpm
cd <extension>
pnpm install
pnpm dev       # import into Raycast with hot reload
pnpm lint
pnpm build
```
