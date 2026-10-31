# Install Ghostgrid on your iPhone (free, no Mac)

Ghostgrid is built on GitHub's Macs as an unsigned app (`Ghostgrid.ipa`). You sign it with your own free Apple ID and install it from your Windows (or Linux) computer with a sideload tool.

**Limits of a free Apple ID:** the app runs for **7 days**, then you re-sign it (about a minute). Maximum 3 sideloaded apps, and only on your own devices. Sharing with others (TestFlight) needs the paid Apple Developer Program.

## One-time setup

1. **iTunes on Windows** — install it from apple.com (the tool needs Apple's USB drivers).
2. **iloader** — open source, MIT licence: https://github.com/nab138/iloader (Windows, macOS, Linux). Download the latest release for your system.
3. **Developer Mode on the iPhone** — Settings → Privacy & Security → Developer Mode → on, then restart the phone. (The option appears after a first sideload attempt if you don't see it yet.)

## Each new build

1. Open the repository on GitHub → **Actions** → **iOS build (unsigned .ipa)** → the latest green run.
2. Under **Artifacts**, download **Ghostgrid-ipa** (you must be signed in to GitHub). Unzip it: you get `Ghostgrid.ipa`.
3. Connect the iPhone with a cable, unlock it and tap **Trust** if asked.
4. Open iloader, sign in with your Apple ID, choose `Ghostgrid.ipa` and install.
5. First launch only: Settings → General → **VPN & Device Management** → your Apple ID → **Trust**.

After 7 days the app stops opening: connect the iPhone and install the same `.ipa` again with iloader.

## Test plan for the proof of concept

| # | Test | How | What we want to see |
| --- | --- | --- | --- |
| 1 | Click on the speaker | Play at 100 BPM, then 220 BPM | Steady click, beats light up in time |
| 2 | Click via Bluetooth audio | Pair the TD-27 for audio in iOS Settings → Bluetooth, then Play | Click comes out of the module; *Playing through* shows Bluetooth |
| 3 | Bluetooth MIDI | In the app: **Pair Bluetooth MIDI**, pick the TD-27, hit a few pads | *Connected: TD-27*; each hit shows note, pad name and velocity |
| 4 | Pad mapping | Note map **Roland TD**; hit kick, snare (head + rim), hi-hat open/closed/pedal, toms, ride, crashes | Every pad shows the right name |
| 5 | Timing per pad | Play, then **Calibrate pads** (8 hits on the click), then play a groove | Offsets per pad, stable from run to run |
| 6 | Mic + Bluetooth (the big one) | *Keep click on Bluetooth* on, then **Microphone on** | Click **stays** on the module; mic level moves when you play |
| 7 | Comparison | Turn *Keep click on Bluetooth* off with the mic on | Click jumps to the iPhone speaker (that is the Safari behaviour we fixed) |
| 8 | Background | Start the click and lock the phone | Click keeps playing |

Write down per test: works / doesn't / notes, plus the *Output delay* value with speaker and with Bluetooth.
