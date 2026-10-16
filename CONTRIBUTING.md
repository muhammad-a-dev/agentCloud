# Contributing to agentCloud

Thanks for helping! agentCloud is built for **non-technical users**, so the most important rule is:
every screen, message and error must make sense to someone who has never used a terminal.

## Getting set up

```bash
git clone <your fork>
cd agentCloud
npm install
npm run dev
```

You need Node.js 22+ and a Claude account (Claude Code sign-in or an API key) to try the agent features.
If Electron didn't download during install, run `node node_modules/electron/install.js`.

## Before you open a pull request

- `npm run typecheck` passes.
- `npm run build` works.
- You tried your change in the running app (see *Testing tips* in the README for a throwaway profile).
- New user-facing text uses plain words ("Connections", not "MCP servers"; "Team", not "subagents").
- Colors come from the theme tokens in `src/styles/index.css`, not hard-coded values.
- Main-process code never sends raw errors or stack traces to the UI: map them to a friendly message (see `classifyError` in `electron/claude/sdk.ts`).

## Where things live

| Area | Files |
|---|---|
| Manager / chat sessions & prompts | `electron/claude/manager.ts` |
| Tools the Manager can call | `electron/claude/appTools.ts` |
| Background tasks | `electron/claude/agentRunner.ts` |
| IPC contract (main ↔ UI) | `shared/api.ts`, `shared/types.ts` |
| Screens | `src/app/` |
| Components | `src/components/` |

To add an IPC method: add it to `AgentCloudApi` and `API_METHODS` in `shared/api.ts`, then add a handler in `electron/main.ts`.

## Good first contributions

- Test and fix the Telegram channel with a real bot
- Other message channels (Discord, Slack, WhatsApp, email)
- macOS / Linux packaging and testing
- Light theme polish
- Translations

## Privacy

Never commit personal data: no API keys, tokens, real email addresses, screenshots of your desktop, or local paths.
Use a throwaway profile (`AGENTCLOUD_USER_DATA`) when taking screenshots.

By contributing you agree your work is released under the MIT License.
