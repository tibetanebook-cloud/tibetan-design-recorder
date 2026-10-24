# Installing Nangchen T. Studio Screen Recorder · ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས།

Download: **https://github.com/tibetanebook-cloud/tibetan-design-recorder/releases/latest**

Pick **one** file:

| Your computer | Download |
|---|---|
| Windows 10/11 | `Nangchen-Recorder-<version>-Windows-Setup.exe` |
| Mac with Apple chip (M1, M2, M3, M4) | `Nangchen-Recorder-<version>-Mac-AppleSilicon.dmg` |
| Mac with Intel chip | `Nangchen-Recorder-<version>-Mac-Intel.dmg` |

Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple chip,
"Processor: Intel…" means Intel.

The Windows installer installs for the current user; you can choose the folder. Linux builds are
no longer published (they can still be built from source: `npm run dist:linux`).

## The first start (these builds are not code-signed yet)

The app is not signed with a paid certificate yet, so the system asks you to confirm once:

- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**. The
  installer then shows "Unknown publisher"; click **Yes**.
- **macOS:** open the `.dmg`, drag the app to Applications, open it. macOS says it "cannot
  verify" the app → open **System Settings → Privacy & Security**, scroll down, click
  **Open Anyway**, and confirm. After that it opens normally.

If Windows blocks the file with **no** "Run anyway" option, the PC has *Smart App Control*
turned on, which refuses unsigned programs. Please don't turn Smart App Control off (it
can't be turned back on without reinstalling Windows); a signed build will fix this.

## Permissions

The first recording asks for permission to use the screen, camera and microphone:

- **Windows:** Settings → Privacy & security → Camera / Microphone → allow desktop apps.
  Some laptops also have a camera shutter or microphone mute key.
- **macOS:** System Settings → Privacy & Security → **Screen & System Audio Recording**,
  **Camera** and **Microphone** → turn on Nangchen T. Studio Screen Recorder, then restart the app.

## Where your files are

- Recordings: `Videos/Nangchen T. Studio Screen Recorder/` (one folder per recording).
- Exports: `Videos/Nangchen T. Studio Screen Recorder/Exports/`.
- Projects (`.tdrec`): wherever you save them. Double-clicking one opens it in the app.
- Settings, autosave, your library items and extensions: the app's data folder
  (`%APPDATA%\Nangchen T. Studio Screen Recorder` on Windows,
  `~/Library/Application Support/Nangchen T. Studio Screen Recorder` on macOS).
  Upgrading from 0.1 (called Tibetan Design Recorder then): your settings, library and
  autosaves are copied over the first time the new version starts; the old folder is kept.

Uninstalling the app never deletes recordings, exports, projects or settings.

## Uninstalling

- **Windows:** Settings → Apps → Installed apps → Nangchen T. Studio Screen Recorder → Uninstall.
- **macOS:** drag the app from Applications to the Bin.
