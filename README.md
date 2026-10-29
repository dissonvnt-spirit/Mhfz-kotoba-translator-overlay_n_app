# MHFZ-Z Translator Overlay

Disclaimer: 

This is a passion project, started by one guy with basic coding knowledge. Much of this app was made with the use of an AI Agent through the use of vibe coding where my skillset was insufficient. This is NOT crowd funded, all Ai usage is handled through my private OpenAi API key which I maintain, as such there are purposely implemented limits on daily usage by anyone other than me. The express purpose of this integration is for application cloud testing, Ai assisted translation in the event of local translation failure and local/server documentation of MHFZZ untranslated/translated dialogue.

Source Code is completely public, feel free to reach out to me in regards to any feature requests that are sensible or if you notice any bugs/errors/mistakes in coding/application performance at my Discord @.spirit07

#Overview

Japanese-to-English dialogue translation companion for Windows x64, including a Tauri desktop overlay and a separate translation API.

An unofficial, independently developed companion; not affiliated with or endorsed by Capcom.
Version 0.2.4 introduces the MHFZ-Z Translator Overlay name and hunter-inspired
interface. Older releases retain their original names. Internal application IDs,
storage keys, and the portable binary name remain unchanged for compatibility.

## Windows downloads and updates

Download the latest installer from [GitHub Releases](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/releases/latest). The portable `kotoba-overlay.exe` is also attached to each successful release.

The installer is recommended. The portable app requires Microsoft Edge WebView2 Runtime. Builds are currently unsigned, so Windows may show a SmartScreen warning. Windows/game interaction has not yet been tested on a physical Windows machine.

Clean-machine prerequisite testing is **not yet run**. The
[WebView2 test checklist](artifacts/kotoba-overlay/WEBVIEW2-CHECKLIST.md)
covers online setup, first launch, offline failure, and recovery.

Updates and their release notes are provided exclusively through GitHub Releases.
The app does not check for updates, display update notices, open an update page,
or download/install updates. Visit GitHub Releases yourself to read what changed,
requirements, known limitations, and installation instructions for each version.

To update, download the Windows x64 setup executable, finish your translation
session, close MHFZ-Z Translator Overlay and its dialogue overlay, and run the installer yourself.
For a portable installation, replace the executable while the app is closed.

**If an update is incompatible:** read the
[update compatibility and recovery notice](UPDATE-RECOVERY.md) before uninstalling
or clearing data. It explains safe backups, what to report through the feedback
widget/GitHub Issues, and when a clean install of a fixed/future version is an
appropriate last resort. Native upgrade preservation remains unverified.

### Dialogue backups and server archives (v0.2.5)

Open **Dialogue journal → Backups and archive**. Choose **JSON**, **CSV**, or
**TXT** to save a local file. JSON/CSV support re-import; TXT is a readable copy.
Keep files outside the installation folder. Import several JSON/CSV files to
compile/deduplicate them locally and merge them into the journal without replacing
existing entries. The journal holds up to 500 lines and pauses translation at
capacity until you export and clear it; files/archives are not silently truncated.

Optionally give the compiled archive a title, explicitly consent to sending it
to the displayed service, and upload it. Save its **recovery receipt** outside the
app. Later, use that recovery code with the same service to fetch, export, merge,
or permanently delete the archive. Anyone with the code can retrieve/delete it;
operators can access stored dialogue. No codes are kept in local storage, no
archive is publicly listed, and dialogue is never automatically uploaded.
Maintain a local copy too. Imports and uploads are limited to 1 MiB and 500 unique
lines per compiled archive; server uploads are limited to 5/hour per IP per
server instance, with bounded database-wide storage (512 MiB/10,000 archives).

Server operators must run the updated API with its `dialogue_archives` schema.
The API accepts parsed dialogue records, not original file bytes. Archives are
separate from cloud translation, are not used for AI training/translation, and
remain until deleted using their code or removed by a service operator.
Missing/full storage fails explicitly; it never reports a successful backup.
The new source/release notes do not add these features to an already downloaded
older installer.

## First launch

1. Start the app. **On-device Japanese-to-English translation is the default.**
2. While connected to the internet, choose **Prepare local model** in Session setup and wait until it is ready. Allow a few hundred MB of free disk space for setup; local inference also needs free memory and CPU time.
3. Select the game's screen/window and mark its Japanese dialogue area. Horizontal and vertical Japanese OCR data are included in the application.
4. Start capture and open the always-on-top overlay. Windowed or borderless-windowed game mode is recommended; exclusive fullscreen may obscure external overlays.
5. To use cloud translation instead, choose **Cloud (OpenAI)** and accept the privacy prompt. The developer's OpenAI key stays on the server. Players do not enter an API key or service token. This choice lasts for the current session only.

In on-device mode, OCR and translation run locally; dialogue and captured frames are not uploaded. Ordinary local translation is cache-only and never silently downloads model assets or falls back to cloud. After preparation, the desktop app can translate without an internet connection, including after restarting. Clearing application/site data or losing cached storage requires another download. The browser preview itself still needs its web page loaded; the installed desktop app bundles that page and its executable runtimes.

Cloud mode sends recognized dialogue, not captured frames, to the configured service and OpenAI. The service is free for players within its shared allowance, but incurs charges for the developer. Returning offline selects on-device mode. No automatic cloud fallback occurs.

The preconfigured desktop cloud service is `https://Mhfzz-game-translator.replit.app`. Advanced users may specify another HTTPS service URL. The service must remain published with cloud translation enabled and a valid server-side provider key.

## Translation API

The API source is in `artifacts/api-server`. Deploy it separately to a Node.js host with HTTPS. GitHub Actions builds desktop downloads; GitHub Pages cannot run this API.

Set these values securely on the API host:

- `OPENAI_API_KEY`: your OpenAI key.
- `KOTOBA_API_TOKEN`: a separate random service token of at least 32 bytes.
- `KOTOBA_PUBLIC_CLOUD_ENABLED`: set to `true` to enable the optional developer-funded endpoint. Any other value disables it.
- `KOTOBA_CLOUD_DAILY_LIMIT`: optional shared daily request allowance; defaults to 100 and is capped at 1000. Reservations are counted even when a provider request fails.
- `DATABASE_URL`: PostgreSQL connection for the durable cloud-usage counter. Apply the development schema through Publish before enabling the feature in production.
- `PORT`: the host's HTTP port.

The original `/api/translate` endpoint remains bearer-authenticated. The separate `/api/cloud/translate` endpoint requires the client's consent header but no player credential; the header records intent, not authentication. It validates dialogue length, limits requests to five per minute per network address and two concurrent provider calls per server process, and reserves requests atomically against a database-backed UTC daily allowance shared across restarts and server instances. Missing quota storage fails closed. Provider retries are disabled, requests time out after 25 seconds, and output tokens are bounded. Only aggregate daily counts are stored for quotas, never dialogue or player identifiers. Provider errors and keys are not exposed.

The daily allowance limits request counts, not exact dollar spending. Use a dedicated OpenAI project/key with appropriate provider-side limits as an additional safeguard. Configure proxy trust carefully for the hosting network; never blindly trust client-supplied forwarded IP headers.

Translation attempts, including failed authentication, share a 60-per-minute
limit per client IP (IPv6 addresses are grouped by subnet). This is an
in-memory, per-server-instance limit, not a deployment-wide quota.

The API trusts exactly one reverse-proxy hop. The public listener must remain
behind a proxy that appends or overwrites `X-Forwarded-For` with the real client
address; do not expose it directly to the internet with this setting. If changing
hosts or proxy topology, review this trust boundary before deployment.

CORS permits only the packaged Tauri origins (`http://tauri.localhost` and
`tauri://localhost`), plus `http://localhost:1420` in development. The hosted web
overlay should use its same-origin API. Other browser origins receive no CORS
permission; CORS is not authentication. The legacy `/api/translate` endpoint
requires its service token; the separate `/api/cloud/translate` endpoint uses
explicit player consent and the developer-funded shared allowance instead.

For local API development:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run dev
```

### API regression tests

Run `pnpm --filter @workspace/api-server test`. The cloud spending tests require
PostgreSQL's `initdb` and `pg_ctl` on `PATH` (or set `POSTGRES_BIN` to their
directory), a Unix-like environment, and a non-root user. Missing tools fail the
suite explicitly rather than skipping the spending checks.

The tests create and remove a temporary PostgreSQL cluster that accepts only
local Unix-socket connections. They do not use `DATABASE_URL`, existing quota
tables, or configured provider credentials. OpenAI is replaced with a synthetic
provider. Separate route instances compete against the same real database to
exercise the atomic daily reservation, including first-use and nearly exhausted
allowances, UTC rollover, storage failures, and failed provider requests.

## Build and publish

See [Windows build instructions](artifacts/kotoba-overlay/WINDOWS.md).

- Push changes to `main` to build installer/portable artifacts using `windows-latest`.
- Run **Build MHFZ-Z Translator Overlay for Windows x64** manually from the repository's Actions page for an on-demand build.
- To publish an update, update the version in Tauri configuration, Cargo metadata and Cargo.lock, write `artifacts/kotoba-overlay/releases/vX.Y.Z.md`, then push a matching `vX.Y.Z` tag. A successful build creates a GitHub Release with both executables, those release-specific notes, and generated GitHub change history.
- Each release's notes must clearly describe **Changes**, **Windows downloads**, **Updating**, and **Requirements and known limitations**. The Windows workflow rejects missing/unfinished notes and mismatched Tauri/Cargo versions or release tags. Do not reuse an old version's notes for a new release.
- Never commit API keys, service tokens, `.env` files, or signed credentials.

## License

The project's original source code is available under the [MIT License](LICENSE).
Copyright notices and the license text must be retained when redistributing it.

Third-party libraries, translation models and OCR components retain their respective licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).
This license does not grant rights to Monster Hunter Frontier Z, game assets,
trademarks, or third-party services.
