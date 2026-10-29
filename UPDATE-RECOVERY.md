# Update compatibility and recovery notice

This notice applies to updates from **Kotoba Overlay** to **MHFZ-Z Translator
Overlay**, and to future releases. Keep the release notes for both your old and
new versions. Retaining the application identifier and storage names is intended
to preserve data; it is **not a guarantee** of Windows installer compatibility.
Native upgrade/data-preservation testing has not been completed.

## Before updating

1. Finish your translation session. If your version provides **Dialogue journal
   → Backups and archive**, export your dialogue. **JSON** is recommended for
   restoring; **CSV** is also importable, while **TXT** is a readable copy only.
   Save files outside the installation and application-data folders, such as
   Documents or a backup drive. Open the saved file and check it contains the
   expected Japanese and translated lines before relying on it.
2. Optionally import several JSON/CSV exports in **Backups and archive** to
   compile them, give the archive a title, and explicitly agree to upload it.
   Uploading is separate from translation consent and never automatic. Save the
   **recovery receipt**, including its code and service address, outside the app.
   Anyone with that code can read or delete the archive. The service operator can
   access stored dialogue, so avoid sensitive material. Keep a local backup even
   after uploading; server availability is not guaranteed.
3. Record your preferences, capture region, and service address separately.
   Dialogue exports do **not** contain preferences, downloaded models, screenshots,
   or credentials. Model caches may need downloading again after a clean install.
4. Older releases do not have the export feature. If yours cannot export, do not
   clear its data to make way for the update. Close it and back up its existing
   application-data/WebView-profile and model-cache folders first. These may
   contain private information: do not attach full folders to feedback. If you
   cannot identify the correct folders, ask for help before uninstalling.
5. Close **both** the main application and the dialogue overlay. Download the
   Windows x64 installer from the project's
   [GitHub Releases](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/releases),
   read that version's requirements and known limitations, and run it manually.
   Portable users should close the app before replacing its executable.

## If an older release appears incompatible with the update

Examples include the app failing to launch, duplicate old/new entries in Windows
Installed apps, stale shortcuts, missing preferences or history, and a previously
prepared model no longer loading.

1. **Stop and protect your data.** Do not repeatedly run different installers,
   delete cache/profile folders, or select an option that removes application
   data. Export any accessible dialogue and keep the old installer and backup.
2. Close all overlay/app windows, restart the app, and confirm you launched the
   intended version rather than an old shortcut or portable copy. A restart of
   Windows can also clear a leftover process. Do not uninstall Microsoft Edge
   WebView2 as a troubleshooting step.
3. **Send a short summary through the feedback widget**, wherever it is available
   on the hosted app/project. If the application cannot open or the widget is
   unavailable, use a
   [GitHub issue](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/issues).
   Include:
   - Old and new versions and the exact installer filenames; installer versus
     portable usage.
   - Windows version/build, what you did, what you expected, and what happened.
   - The exact visible error and whether settings, history, model readiness,
     shortcuts, or Installed apps entries changed.
   - Whether you have a local dialogue backup and whether the old version still
     opens. A small redacted screenshot is useful if relevant.

   Never include API keys, access tokens, archive recovery codes, private dialogue,
   or complete user-profile folders in public feedback. Example:

   > Updated from [old version] to [new version] on Windows [build] using
   > [installer filename]. After closing both windows and installing, [symptom].
   > Expected [result]. Error: [exact message]. My history is [present/missing],
   > model is [ready/not ready], and I [do/do not] have a dialogue backup.

4. If the old version still works, you may stay on it while the incompatibility
   is investigated. Restoring an older release is not guaranteed safe for a newer
   data format: preserve backups and follow release-specific guidance before
   downgrading. Do not run both versions against the same profile concurrently.
5. Watch **GitHub Releases** for a fix and read its recovery instructions before
   trying again. There are no in-app update checks or update notices.

## If incompatibility remains unresolved: clean install as a last resort

A clean install may reset settings and erase dialogue or model caches. It is
optional, **not the first troubleshooting step**, and is not guaranteed to fix a
capture, translation-service, or model-download defect.

1. First save verified dialogue files and any server recovery receipt outside
   the app, plus a private copy of the old profile/cache if applicable. If your
   dialogue is inaccessible and you have no backup, seek help rather than clearing
   its data.
2. Fully close both app windows. In Windows **Settings → Apps → Installed apps**,
   uninstall the affected application. Check the install location/version before
   acting on duplicate Kotoba/MHFZ-Z entries; do not blindly uninstall every entry.
   Preserve user data if the uninstaller offers that choice.
3. Only if the fixed/future release's instructions require a fresh profile, and
   only after backups are secure, move the identified old app-specific data/cache
   folders to a private backup location. Do not delete broad AppData directories,
   unrelated programs' folders, or WebView2 itself.
4. Install the intended fixed or future Windows x64 release from GitHub. Confirm
   the new shortcut launches the correct product/version. Remove only verified
   stale shortcuts; report duplicate/unremovable Installed apps entries rather
   than manually deleting registry keys.
5. Re-enter preferences. Use **Prepare local model** while online if necessary;
   dialogue backups do not restore model weights.
6. In a version supporting backups, choose JSON/CSV files in **Backups and
   archive**, review the preview/count, and choose **Merge into journal**.
   This deduplicates entries rather than replacing existing history. Or enter the
   saved private recovery code against the **same service address** to fetch,
   export, or merge a server archive.

The backup/archive feature is new in **v0.2.5** source and must be included in a
new installer before installed users can use it. It cannot retroactively recover
lines already lost or discarded by an earlier release. The local journal and
each compiled archive support up to 500 unique lines; each imported file and
server upload is limited to 1 MiB. Export before the journal reaches its limit.
Keep multiple dated files for longer histories.
