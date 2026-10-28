# Windows x64 desktop build

Kotoba Overlay includes a Tauri 2 desktop shell and an NSIS installer target for
64-bit Windows. Build it from a Windows machine with Node.js, pnpm, Rust, the
Microsoft C++ Build Tools, and WebView2 installed:

```powershell
pnpm install
pnpm --filter @workspace/kotoba-overlay desktop:build:windows
```

The installer is written under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

For local development, run:

```powershell
pnpm --filter @workspace/kotoba-overlay desktop:dev
```

The packaged desktop app needs the published Kotoba API URL configured in its
translation-service settings. The OpenAI key belongs only in the API server's
project Secrets; it is never bundled into the Windows installer.

Before using a published translation service, configure `KOTOBA_API_TOKEN` in
the API server's project Secrets with a random value of at least 32 characters.
Enter the same token in Kotoba's session settings after launch. The desktop app
keeps that token in memory only; it is not written to disk or included in the
installer. Never reuse the OpenAI key as the service token.

The GitHub Actions workflow at `.github/workflows/kotoba-windows-x64.yml` builds
on a Windows x64 runner, verifies the app executable's PE architecture, and
publishes both the NSIS installer and portable executable as build artifacts.
Use the installer for normal setup; the portable executable may require WebView2
to be installed on the Windows machine.
