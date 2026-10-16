# Security

agentCloud lets AI agents edit files and run programs on your computer (in **Full access** mode, without asking first).
Please treat security issues seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.
Use GitHub's **"Report a vulnerability"** button (Security tab → Advisories) to report it privately.
We'll reply as soon as we can.

## Good to know

- All agent work happens inside the workspace folder the user picks, but agents in Full access mode can run commands. Use *Ask before risky actions* in Settings → Permissions if you want to approve each risky step.
- API keys and bot tokens are stored encrypted with Electron `safeStorage`; they are never written to plain-text files by agentCloud.
- The Telegram channel only accepts orders from chats that sent the one-time pairing code.
