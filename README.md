# Usage Monitor

[![HOL Guard](https://img.shields.io/endpoint?url=https%3A%2F%2Fhol.org%2Fapi%2Fregistry%2Fbadges%2Fplugin%3Fslug%3Derrr0rr404%252Fusage-monitor%26metric%3Drelease)](https://hol.org/registry/plugins/errr0rr404%2Fusage-monitor)

A small floating desktop meter for Grok, MiniMax, Codex, Claude, Cursor, Copilot, Gemini (Antigravity), Muse, OpenCode, DeepSeek, OpenRouter, Kimi Code, the Kimi API, Z.ai, Vercel AI Gateway, Poe, and SiliconFlow. Sign in with your usual browser, or paste an API key for the services that use one. Usage Monitor reads what is left on each account and keeps the session on this computer.

![Usage Monitor with Grok, MiniMax, Codex, Cursor, Copilot, Gemini, and Muse](docs/screenshot.jpg)

It runs on macOS and Windows.

## Menu bar

The menu bar on a Mac, and the tray icon on Windows, show one account. On a Mac, Usage Monitor stays there and does not take a place in the Dock. The ring uses the app blue and fills with what is left. Under 15 percent it turns orange, then red at 0.

- One signed-in account is used automatically.
- With more than one, tap the star on the account you want up there. That reading stays until you pick another.

Hide sends the window to that icon. Quit from the icon. Keep on top, in the settings menu, holds the window above other apps. On macOS it also stays visible on every desktop.

Usage Monitor refreshes every 5 minutes. Change that, or turn it off, from the settings menu. The header says how long ago the newest reading came in; click it to refresh now.

If a usage window drops under 15 percent, Usage Monitor sends one notification. It does not ping again until that window recovers and drops again.

When a 5-hour, weekly, or monthly window resets, Usage Monitor shows a compact notice above the gauges and plays a soft chime. The notice groups the windows by account and stays until you dismiss it with the close button or Escape. A hidden window reappears without taking keyboard focus. Turn the chime off with Reset sound in settings, or use Test reset notice to try it. Compact mode temporarily expands for notices, settings, and sign-in, then returns to its previous size. The first check after an update only records the current deadlines.

## Sign in

Each service opens the public login that can hand a session back to an app on this computer. The approval page may say Grok CLI, MiniMax CLI, Codex, Claude Code, Cursor, Visual Studio Code, Antigravity, or Meta. That is expected. Usage Monitor does not have its own account, and it does not send your login anywhere except the service you picked.

Sessions are locked with the operating system: the macOS keychain, or Windows DPAPI.

Gemini signs in through Antigravity and shows every model it meters. The shared Claude & GPT pool shows its week and 5 hours (marked paused while Google switches the 5 hours off), and the Gemini models follow, grouped into one row when they share a quota. Each pooled row lists its models.

## API keys

These services are read with an API key instead of a browser login. Paste the key, or use the key OpenCode already saved on this computer (`~/.local/share/opencode/auth.json`). Each key is read once before it is saved, so a wrong key never lands on the board. Keys are locked the same way as sessions.

| Service | Key | What the card shows |
| --- | --- | --- |
| OpenCode | An OpenCode API key | OpenCode Go 5-hour, weekly, and monthly limits |
| DeepSeek | A DeepSeek API key | The account balance |
| OpenRouter | A management key | The credits left on the account |
| Kimi Code | The key from a Kimi Code membership | The rolling and weekly request limits |
| Kimi API | A Moonshot AI platform key (.ai or .cn) | The account balance, vouchers included |
| Z.ai | A Z.ai or Zhipu BigModel key on a GLM Coding Plan | The rolling token limit and the MCP call allowance |
| Vercel AI | A Vercel AI Gateway key | The gateway credits left |
| Poe | A Poe API key | The compute points left |
| SiliconFlow | A SiliconFlow key (.com or .cn) | The account balance |
| MiniMax | A Token Plan key (optional) | The same limits as the browser login, video included |

A regular OpenRouter key cannot read the account's credits. It shows its own spending limit instead, if it has one.

Services with a China site (Kimi API, Z.ai, SiliconFlow, MiniMax) try the global host first and remember the one that accepted the key. MiniMax still signs in with the browser by default; paste a key there only if you would rather not.

## Download

Installers are on the [latest release](https://github.com/Errr0rr404/usage-monitor/releases/latest).

| Computer | File |
| --- | --- |
| Mac with Apple silicon | `Usage-Monitor-*-mac-arm64.dmg` |
| Mac with Intel | `Usage-Monitor-*-mac-x64.dmg` |
| Windows 64-bit | `Usage-Monitor-*-win-x64.exe` |
| Windows 32-bit | `Usage-Monitor-*-win-ia32.exe` |

The zip files are the same Mac apps without a disk image.

Mac disk images are signed with a Developer ID and notarized by Apple. Open the disk image and drag Usage Monitor into Applications. On Windows, if SmartScreen appears, choose More info, then Run anyway. Usage Monitor needs Windows 10 or newer, including 32-bit Windows.

## Run it

You need Node.js 22 or newer.

```bash
npm install
npm start
```

## Build

```bash
npm run dist:mac
npm run dist:win
```

`dist:mac` builds Apple silicon and Intel, then notarizes the disk images. It needs `APPLE_API_KEY` (path to the App Store Connect `.p8` key), `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`, and a Developer ID Application certificate in the keychain. `dist:win` builds 64-bit and 32-bit installers.

## License

[MIT](LICENSE)
