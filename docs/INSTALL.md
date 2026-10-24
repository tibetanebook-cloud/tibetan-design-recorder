# Installing Nangchen T. Studio Screen Recorder · ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས།

Download: **https://github.com/tibetanebook-cloud/tibetan-design-recorder/releases/latest**

| System | File | Notes |
|---|---|---|
| Windows 10/11 (most PCs) | `nangchen-t-studio-screen-recorder-<version>-windows-x64-setup.exe` | Installs for the current user; you can choose the folder. |
| Windows on ARM (Surface Pro X, Snapdragon laptops) | `…-windows-arm64-setup.exe` | |
| Windows, no install | `…-windows-x64-portable.exe` | Runs from a USB stick or any folder. |
| macOS 12+ on Apple Silicon (M1–M4) | `…-macos-arm64.dmg` | |
| macOS 12+ on Intel | `…-macos-x64.dmg` | |
| Linux (Ubuntu, Debian, Mint…) | `…-linux-amd64.deb` (ARM: `…-linux-arm64.deb`) | `sudo apt install ./nangchen-t-studio-screen-recorder-…deb` |
| Linux (any distribution) | `…-linux-x86_64.AppImage` (ARM: `…-linux-arm64.AppImage`) | Make it executable, then double-click. |

## The first start (these builds are not code-signed yet)

The app is not signed with a paid certificate yet, so the system asks you to confirm once:

- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**. The
  installer then shows "Unknown publisher"; click **Yes**.
- **macOS:** open the `.dmg`, drag the app to Applications, open it. macOS says it "cannot
  verify" the app → open **System Settings → Privacy & Security**, scroll down, click
  **Open Anyway**, and confirm. After that it opens normally.
- **Linux:** no warning.

If Windows blocks the file with **no** "Run anyway" option, the PC has *Smart App Control*
turned on, which refuses unsigned programs. Please don't turn Smart App Control off (it
can't be turned back on without reinstalling Windows); a signed build will fix this.

## Permissions

The first recording asks for permission to use the screen, camera and microphone:

- **Windows:** Settings → Privacy & security → Camera / Microphone → allow desktop apps.
  Some laptops also have a camera shutter or microphone mute key.
- **macOS:** System Settings → Privacy & Security → **Screen & System Audio Recording**,
  **Camera** and **Microphone** → turn on Nangchen T. Studio Screen Recorder, then restart the app.
- **Linux (Wayland):** the desktop's screen-sharing dialog appears; choose the screen or window.

## Where your files are

- Recordings: `Videos/Nangchen T. Studio Screen Recorder/` (one folder per recording).
- Exports: `Videos/Nangchen T. Studio Screen Recorder/Exports/`.
- Projects (`.tdrec`): wherever you save them. Double-clicking one opens it in the app.
- Settings, autosave, your library items and extensions: the app's data folder
  (`%APPDATA%\Nangchen T. Studio Screen Recorder` on Windows,
  `~/Library/Application Support/Nangchen T. Studio Screen Recorder` on macOS,
  `~/.config/Nangchen T. Studio Screen Recorder` on Linux).
  Upgrading from 0.1 (called Tibetan Design Recorder then): your settings, library and
  autosaves are copied over the first time the new version starts; the old folder is kept.

Uninstalling the app never deletes recordings, exports, projects or settings.

## Uninstalling

- **Windows:** Settings → Apps → Installed apps → Nangchen T. Studio Screen Recorder → Uninstall.
- **macOS:** drag the app from Applications to the Bin.
- **Linux:** `sudo apt remove nangchen-t-studio-screen-recorder`, or delete the AppImage.
