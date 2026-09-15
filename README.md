# raycast-extensions

Personal Raycast extensions. Each folder is a standalone extension with its own `package.json`.

| Extension | What it does |
| --- | --- |
| [chrome-tabs-assemble](./chrome-tabs-assemble) | Move all Chrome tabs from every window into the frontmost window, keeping pinned tabs and tab groups |

## Developing an extension

```sh
cd <extension>
npm install
npm run dev    # import into Raycast with hot reload
npm run lint
npm run build
```
