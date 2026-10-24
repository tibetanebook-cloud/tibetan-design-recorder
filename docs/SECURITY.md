# Security

Nangchen T. Studio Screen Recorder · ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས། records your screen,
camera and microphone, so it is built to do only what you ask and nothing else. This page
lists the protections and how they are tested. Last reviewed for 0.2.0 (2026-10-23).

## What the app can reach

| Area | Protection | Where |
|---|---|---|
| Windows (pages) | Context isolation, sandbox, no Node.js in pages, web security on. Pages talk to the app only through a small, typed bridge. | `src/main/index.ts`, `src/preload/index.ts` |
| Navigation and pop-ups | A page can't navigate away from the app, open new windows or embed other web pages. | `src/main/security.ts` |
| Permissions | Camera, microphone, screen capture, the local font list and copying to the clipboard are allowed **only** for the app's own pages; every other permission is refused. | `src/main/security.ts` |
| Reading files | The internal media address serves only media and caption files (video, audio, images, `.srt`/`.vtt`, cursor data); anything else gets "403 Forbidden". | `src/main/media-protocol.ts`, `src/main/policy.ts` |
| Writing files | Exports and project saves go only to a file or folder you picked in a Save/Choose dialog (plus the app's own Videos folder). Project paths must be `.tdrec`. Requests for any other path are refused. | `src/main/policy.ts` (`WritePolicy`) |
| Recordings | Always saved under `Videos/Nangchen T. Studio Screen Recorder/`; a page can't redirect them. Messages from the capture window are accepted only from that window. | `src/main/recording/controller.ts` |
| Auto-captions | Sends only audio/video files, only to an `https://` service (or `http://` on this computer, for a local server). Your API key stays in the app's settings folder. | `src/main/transcribe.ts` |
| Test hooks | The automated-test hooks exist only when the app is started by its own self-test; normal use has none. | `src/preload/index.ts`, `src/renderer/src/App.tsx` |
| Packaged app | Electron fuses: can't be run as plain Node.js, no `NODE_OPTIONS` or debugger flags, the app loads only from its packaged archive, which is integrity-checked; cookies are encrypted. | `electron-builder.yml` |
| Fonts | The app reads only the *names* of the fonts installed on your computer, to list them; nothing is sent anywhere. Bundled fonts are open-source (OFL) and load from the app itself. | `src/main/index.ts` (`fonts:list`), `src/renderer/src/fonts.ts` |
| Extensions | Extensions are data only (styles, wallpapers, sounds); no extension code is run. | `src/main/extensions.ts` |

## Your data

- Nothing is uploaded unless you turn on auto-captions with an online service.
- No analytics, no tracking, no automatic updates contacting a server.
- Settings: `%APPDATA%\Nangchen T. Studio Screen Recorder` (Windows),
  `~/Library/Application Support/Nangchen T. Studio Screen Recorder` (macOS),
  `~/.config/Nangchen T. Studio Screen Recorder` (Linux).

## How it is tested

- Unit tests (`npm test`) check the write policy, the file allow-lists and the settings move from 0.1.
- The self-test (`npm run smoke`) checks that an export to a folder you didn't choose is refused.
- `npm audit` reports 0 known vulnerabilities in the dependencies (checked 2026-10-23).

## Reporting a problem

Please open an issue on GitHub. Don't include recordings or personal files. For something
sensitive, write to the maintainer through the GitHub profile first.
