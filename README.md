# MHFZ Kotoba Translator Overlay

Japanese-to-English dialogue translation companion for Windows x64, including a Tauri desktop overlay and a separate translation API.

## Windows downloads and updates

Download the latest installer from [GitHub Releases](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/releases/latest). The portable `kotoba-overlay.exe` is also attached to each successful release.

The installer is recommended. The portable app requires Microsoft Edge WebView2 Runtime. Builds are currently unsigned, so Windows may show a SmartScreen warning. Windows/game interaction has not yet been tested on a physical Windows machine.

Updates are distributed through GitHub Releases; the app does not silently install updates or contain an automatic updater.

## First launch

1. Start the app and enter the URL of your running translation API in session settings.
2. Enter that API's `KOTOBA_API_TOKEN`. **Do not enter your OpenAI key in the desktop app.**
3. Select the game's screen/window and mark its Japanese dialogue area.
4. Choose horizontal or vertical Japanese OCR and start capture.
5. Open the always-on-top translation overlay. Use windowed or borderless-windowed game mode; exclusive fullscreen may obscure external overlays.

OCR runs locally. Recognized text is sent to the configured translation API and OpenAI for translation; captured screenshots are not sent by this app. Translation requests can incur OpenAI charges.

## Translation API

The API source is in `artifacts/api-server`. Deploy it separately to a Node.js host with HTTPS. GitHub Actions builds desktop downloads; GitHub Pages cannot run this API.

Set these values securely on the API host:

- `OPENAI_API_KEY`: your OpenAI key.
- `KOTOBA_API_TOKEN`: a separate random service token of at least 32 bytes.
- `PORT`: the host's HTTP port.

The API requires bearer authentication, validates request payloads, limits request size and rate, and does not expose provider errors or keys. Desktop service tokens stay in memory and must be entered again after restarting.

For local API development:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run dev
```

## Build and publish

See [Windows build instructions](artifacts/kotoba-overlay/WINDOWS.md).

- Push changes to `main` to build installer/portable artifacts using `windows-latest`.
- Run **Build Kotoba Overlay for Windows x64** manually from the repository's Actions page for an on-demand build.
- To publish an update, update the version in Tauri configuration and Cargo metadata, then push a matching `vX.Y.Z` tag. A successful build creates a GitHub Release with both executables.
- Never commit API keys, service tokens, `.env` files, or signed credentials.

## License

The project's original source code is available under the [MIT License](LICENSE).
Copyright notices and the license text must be retained when redistributing it.

Third-party libraries and OCR components retain their respective licenses.
This license does not grant rights to Monster Hunter Frontier Z, game assets,
trademarks, or third-party services.
