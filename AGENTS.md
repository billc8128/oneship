# Repository Rules

## Electron Testing Safety

- Default all app behavior validation to `pnpm dev`.
- Do not launch packaged Oneship apps from `release/` or `/Applications/` for routine smoke tests.
- Treat every packaged Oneship app as `prod` runtime, sharing the live prod state directories.
- Do not start a second packaged Oneship instance while `/Applications/Oneship.app` or another packaged Oneship process is already running.
- Only run packaged-build verification when the user explicitly asks for it.
- If packaged-build verification is explicitly required, warn that it can affect live prod state and get confirmation before launching the packaged app.
