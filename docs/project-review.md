# Project review — October 14, 2026

## Changes

The reset alarm is now one notice above the gauges. It groups resets by account, merges subsequent notices, and dismisses with its close button or Escape. It uses the existing theme colors, respects reduced motion, and leaves keyboard focus alone. A short chime replaces the siren; settings include a sound toggle and a test notice.

| Problem | Fix |
| --- | --- |
| Missing usage was converted to zero, causing false reset alarms. | Unknown readings remain unknown. |
| Cursor and Copilot treated 1% as a fraction and displayed 100%. | Explicit percentage fields retain their 0–100 scale. |
| Muse could spend a live-meter request without opting in. | Live reads require an explicit account preference. |
| A rotated refresh token was lost when the subsequent usage request failed. | The replacement session is retained for the next refresh. |
| Escape closed sign-in without canceling it; late responses could affect a newer form. | Cancellation reaches the login flow, and stale responses are ignored. |
| Cancel during Gemini setup could still open the browser afterward. | Cancellation is checked before opening the login. |
| A device token could finish sign-in after cancellation. | Canceled sessions cannot return a successful login. |
| Compact windows clipped settings and forms, and refresh could shrink an active alarm. | The window expands while those controls are open and restores compact size afterward. |
| Moving a compact window restored the old position afterward. | The restored bounds retain the new position. |
| Moving the window during sign-in could lose the pin preference. | The saved preference is independent of the temporary sign-in window state. |
| Reset countdowns stayed stale between refreshes. | Countdown text updates locally and relative durations account for the fetch time. |
| A small remaining percentage rounded to a misleading zero in the gauge. | The gauge keeps the fractional reading. |
| Compact mode mislabeled all failures as expired logins and hid refresh errors. | Failures retain their actual explanation. |

The README also no longer claims a release workflow exists in this checkout.

## Verification

- All 76 Node tests pass, including regressions for reset detection, percentage parsing, token rotation, live-meter opt-in, and login cancellation.
- Electron UI checks passed for individual and grouped notices, refresh while a notice is open, compact-size restoration, all three themes, the minimum window size, long account lists, reduced motion, keyboard focus, and sign-in error recovery.
- Checks using a separate temporary data directory confirmed that canceled tokens are never saved, moving during sign-in preserves pinning, compact movement is retained, and the sound preference persists.
- An unsigned macOS ARM64 application packaged successfully, launched successfully, and passed a reset-notice smoke test. Signing, notarization, and Windows packaging were not run.
- The normal account store and installed app were not modified during testing. Provider responses were mocked; live account sign-ins and Windows execution were not tested.

## Remaining: dependency security migration

`npm audit` reports 13 affected packages: 10 high and 3 moderate. The Electron 35 runtime ships with the app despite being listed under devDependencies, so these findings should be addressed before a future release.

Electron 43.7.11 is an available migration target that still supports 32-bit Windows. It raises the minimum macOS version to 12; Electron 44 also removes 32-bit Windows support. Decide whether macOS 11 support must remain before changing the runtime. See the [Electron 38 platform change](https://www.electronjs.org/blog/electron-38-0) and [Electron 43 platform support](https://www.electronjs.org/blog/electron-43-0).

The installed electron-builder 26.15.3 is the current stable release, but its downloader chain also has audit findings. Forcing its `@electron/get` dependency to v5 would change download options and proxy behavior. Use a compatible upstream fix or a tested build-tool migration; v27 is currently a prerelease. See the [downloader breaking changes](https://github.com/electron/get/releases/tag/v5.0.0) and [builder migration guide](https://www.electron.build/docs/migration/v27-breaking-changes/).
