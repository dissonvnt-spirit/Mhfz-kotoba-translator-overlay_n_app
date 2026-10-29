import { type ChangeEvent, useRef, useState } from 'react';
import { createDialogueArchive, deleteDialogueArchive, retrieveDialogueArchive } from '@workspace/api-client-react';
import { isTauri } from '@tauri-apps/api/core';
import {
  type BackupFormat, type DialogueLine, downloadDialogue, mergeDialogue, parseDialogueFile,
} from '@/lib/dialogue-backup';
import {
  Archive, Check, CircleHelp, Copy, Download, FileUp, KeyRound, LoaderCircle, Trash2, UploadCloud,
} from 'lucide-react';

type Props = { lines: DialogueLine[]; onRestore: (lines: DialogueLine[]) => void };
type Busy = null | 'parse' | 'upload' | 'retrieve' | 'delete';

const API_BASE_KEY = 'kotoba-translation-api-base';
const DEFAULT_CLOUD_URL = 'https://Mhfzz-game-translator.replit.app';
const CODE_PATTERN = /^[0-9a-f]{64}$/i;
const FORMATS: BackupFormat[] = ['json', 'csv', 'txt'];

function serviceUrl() {
  const saved = (localStorage.getItem(API_BASE_KEY) || '').trim().replace(/\/+$/, '');
  if (saved) return saved;
  return isTauri() ? DEFAULT_CLOUD_URL : window.location.origin;
}

function describeError(error: unknown, action: string) {
  if (!navigator.onLine) return `You are offline, so the archive could not be ${action}. Local exports still work.`;
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403 || status === 404) return 'No archive matches that recovery code. Check every character and try again.';
  if (status === 413) return 'The compiled dialogue is too large for the service. Remove some files and retry.';
  if (status === 429) return 'Archive request limit reached (per-address or shared daily allowance). Keep your local backup and try again later.';
  if (status === 400) return 'The service rejected this archive. Check the title and dialogue lines, then retry.';
  return `The archive could not be ${action}. Check the service URL in Loadout and your connection, then retry.`;
}

function FormatPicker({ value, onChange, id }: { value: BackupFormat; onChange: (f: BackupFormat) => void; id: string }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Export format">
      {FORMATS.map((f) => (
        <button key={f} type="button" role="radio" aria-checked={value === f} onClick={() => onChange(f)}
          className={`btn-chip font-mono-ui uppercase ${value === f ? 'btn-chip-on' : ''}`} data-testid={`button-format-${id}-${f}`}>{f}</button>
      ))}
    </div>
  );
}

function Preview({ lines, testId }: { lines: DialogueLine[]; testId: string }) {
  return (
    <ul className="max-h-40 divide-y divide-[hsl(var(--bronze)/.15)] overflow-y-auto border border-[hsl(var(--bronze)/.25)] bg-[hsl(var(--ink)/.45)]" data-testid={testId}>
      {lines.slice(0, 6).map((line, i) => (
        <li key={`${line.timestamp}-${i}`} className="px-3 py-2 text-xs">
          <p className="truncate font-jp text-[hsl(var(--parchment)/.65)]" lang="ja">{line.sourceText}</p>
          <p className="truncate text-[hsl(var(--parchment))]">{line.translatedText}</p>
        </li>
      ))}
      {lines.length > 6 && <li className="px-3 py-1.5 font-mono-ui text-[10px] text-[hsl(var(--muted-foreground))]">+ {lines.length - 6} more</li>}
    </ul>
  );
}

export function DialogueBackups({ lines, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef<Busy>(null);
  const [localFormat, setLocalFormat] = useState<BackupFormat>('json');
  const [importFormat, setImportFormat] = useState<BackupFormat>('json');
  const [retrievedFormat, setRetrievedFormat] = useState<BackupFormat>('json');
  const [imported, setImported] = useState<DialogueLine[]>([]);
  const [importNames, setImportNames] = useState<string[]>([]);
  const [importError, setImportError] = useState('');
  const [notice, setNotice] = useState('');
  const [title, setTitle] = useState('');
  const [includeJournal, setIncludeJournal] = useState(true);
  const [consent, setConsent] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [receipt, setReceipt] = useState<{ code: string; count: number; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [retrieved, setRetrieved] = useState<{ title: string; lines: DialogueLine[]; createdAt: string } | null>(null);
  const [retrieveError, setRetrieveError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = kind;
    setBusy(kind);
    try { await fn(); } finally { busyRef.current = null; setBusy(null); }
  };

  const restore = (incoming: DialogueLine[], label: string) => {
    try {
      setImportError('');
      const merged = mergeDialogue(lines, incoming);
      onRestore(incoming);
      setNotice(`${label}: journal now holds ${merged.length} lines. Nothing was replaced.`);
    } catch (error) {
      setNotice('');
      const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      setImportError(quota
        ? 'This device has no room left to save the merged journal. Nothing was changed. Export and clear older lines, then retry.'
        : error instanceof Error ? `${error.message} Nothing was changed.` : 'Merging would exceed the 500-line journal limit. Export and clear older lines first.');
    }
  };

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    void run('parse', async () => {
      setImportError(''); setNotice('');
      try {
        let combined: DialogueLine[] = [];
        for (const file of files) {
          if (file.size > 1024 * 1024) throw new Error(`${file.name} is larger than 1 MiB.`);
          try {
            combined = mergeDialogue(combined, parseDialogueFile(await file.text(), file.name));
          } catch (error) {
            throw new Error(`${file.name}: ${error instanceof Error ? error.message : 'could not be read'}`);
          }
        }
        setImported(combined);
        setImportNames(files.map((f) => f.name));
      } catch (error) {
        setImported([]); setImportNames([]);
        setImportError(`${error instanceof Error ? error.message : 'Files could not be read.'} Only JSON or CSV exports from this app are accepted.`);
      }
    });
  };

  let uploadLines: DialogueLine[] = [];
  let uploadCompileError = '';
  try { uploadLines = mergeDialogue(includeJournal ? lines : [], imported); } catch (error) {
    uploadCompileError = error instanceof Error ? error.message : 'Compiled dialogue exceeds 500 lines.';
  }
  const trimmedTitle = title.trim();
  if (uploadLines.length && new TextEncoder().encode(JSON.stringify({ title, lines: uploadLines, consent: true })).byteLength > 1024 * 1024) {
    uploadCompileError = 'Combined archive exceeds 1 MiB. Upload fewer files or lines.';
  }
  const canUpload = !busy && !receipt && consent && trimmedTitle.length > 0 && trimmedTitle.length <= 120 && uploadLines.length > 0 && !uploadCompileError;

  const upload = () => {
    if (!canUpload) return;
    void run('upload', async () => {
      setUploadError('');
      const destination = serviceUrl();
      try {
        const result = await createDialogueArchive({ title: trimmedTitle, consent: true, lines: uploadLines });
        setReceipt({ code: result.recoveryCode, count: result.lineCount, url: destination });
        setConsent(false);
        setCopied(false);
      } catch (error) {
        setUploadError(describeError(error, 'uploaded'));
      }
    });
  };

  const copyCode = async () => {
    if (!receipt) return;
    try { await navigator.clipboard.writeText(receipt.code); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* optional */ }
  };

  const saveReceipt = () => {
    if (!receipt) return;
    const text = [
      'MHFZ-Z Translator Overlay - dialogue archive recovery receipt',
      `Service URL: ${receipt.url}`,
      `Recovery code: ${receipt.code}`,
      `Lines stored: ${receipt.count}`,
      `Created: ${new Date().toISOString()}`,
      '',
      'Anyone holding this code can retrieve or delete the archive. Keep it private.',
      'Store this file outside the app folder before uninstalling or upgrading.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `mhfzz-recovery-receipt-${receipt.code.slice(0, 8)}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const cleanCode = code.trim();
  const codeValid = CODE_PATTERN.test(cleanCode);
  const auth = () => ({ headers: { Authorization: `Bearer ${cleanCode.toLowerCase()}` } });

  const retrieve = () => {
    if (!codeValid) return;
    void run('retrieve', async () => {
      setRetrieveError(''); setRetrieved(null); setConfirmDelete(false);
      try { setRetrieved(await retrieveDialogueArchive(auth())); } catch (error) { setRetrieveError(describeError(error, 'retrieved')); }
    });
  };

  const remove = () => {
    if (!codeValid || !confirmDelete) return;
    void run('delete', async () => {
      setRetrieveError('');
      try {
        await deleteDialogueArchive(auth());
        setRetrieved(null); setConfirmDelete(false);
        setNotice('Server archive deleted. Your local journal and saved files were not touched.');
      } catch (error) { setRetrieveError(describeError(error, 'deleted')); }
    });
  };

  const spin = (kind: Busy) => busy === kind ? <LoaderCircle size={13} className="animate-spin" /> : null;

  return (
    <div className="border-b border-[hsl(var(--bronze)/.3)]" data-testid="section-dialogue-backups">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--parchment))]" data-testid="button-toggle-backups">
        <span className="flex items-center gap-2 font-semibold uppercase tracking-[.16em] text-[hsl(var(--bronze-hi))]"><Archive size={13} /> Backups and archive</span>
        <span className="font-mono-ui text-[10px]">{open ? 'Hide' : 'Export, import, recover'}</span>
      </button>
      {open && (
        <div className="rise-in space-y-5 px-5 pb-5">
          {notice && <p className="flex items-start gap-2 border border-[hsl(var(--moss)/.4)] bg-[hsl(var(--moss)/.1)] px-3 py-2 text-xs text-[hsl(var(--moss-hi))]" role="status" data-testid="text-backup-notice"><Check size={13} className="mt-0.5 shrink-0" />{notice}</p>}

          <section className="space-y-2">
            <div className="rune-label">Local export</div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Saves the current journal to a file on this device. Works offline. JSON and CSV can be imported again; TXT is for reading. Keep files outside the installation folder.</p>
            <div className="flex flex-wrap items-center gap-2">
              <FormatPicker value={localFormat} onChange={setLocalFormat} id="local" />
              <button type="button" className="btn-ghost" disabled={!lines.length} onClick={() => downloadDialogue(lines, localFormat)} data-testid="button-export-local"><Download size={13} /> Export {lines.length} lines</button>
            </div>
          </section>

          <section className="space-y-2">
            <div className="rune-label">Import saved files</div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Choose one or more JSON or CSV exports (up to 500 unique lines combined, 1 MiB per file). They are read here and compiled locally; nothing is sent.</p>
            <input ref={fileRef} type="file" multiple accept=".json,.csv,application/json,text/csv" className="hidden" onChange={onFiles} data-testid="input-import-files" />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => fileRef.current?.click()} data-testid="button-pick-files">{spin('parse') ?? <FileUp size={13} />} Choose files</button>
              {imported.length > 0 && (
                <>
                  <button type="button" className="btn-bronze" disabled={!!busy} onClick={() => restore(imported, 'Imported files merged')} data-testid="button-merge-imported">Merge into journal</button>
                  <button type="button" className="btn-chip btn-danger" onClick={() => { setImported([]); setImportNames([]); }} data-testid="button-clear-imported"><Trash2 size={12} /> Discard</button>
                </>
              )}
            </div>
            {importError && <p className="alert-ember" role="alert" data-testid="text-import-error"><CircleHelp size={14} className="shrink-0" />{importError}</p>}
            {imported.length > 0 && (
              <div className="space-y-2">
                <p className="font-mono-ui text-[11px] text-[hsl(var(--parchment)/.8)]" data-testid="text-imported-count">{imported.length} unique lines from {importNames.length} {importNames.length === 1 ? 'file' : 'files'}: {importNames.join(', ')}</p>
                <Preview lines={imported} testId="list-imported-preview" />
                <div className="flex flex-wrap items-center gap-2">
                  <FormatPicker value={importFormat} onChange={setImportFormat} id="imported" />
                  <button type="button" className="btn-ghost" onClick={() => downloadDialogue(imported, importFormat)} data-testid="button-export-imported"><Download size={13} /> Export compiled</button>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2.5">
            <div className="rune-label">Upload archive</div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Stores one compiled copy independently of this installation. Only structured lines are stored, not your files. Service operators can access stored dialogue. Keep a local backup too: server storage and availability are not guaranteed.</p>
            <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} maxLength={120} placeholder="Archive title, e.g. Forokururu story arc"
              className="field h-10 w-full text-sm" aria-label="Archive title" data-testid="input-archive-title" />
            <label className="flex items-center gap-2 text-xs text-[hsl(var(--parchment)/.85)]">
              <input type="checkbox" checked={includeJournal} onChange={(e) => setIncludeJournal(e.target.checked)} className="accent-[hsl(var(--bronze))]" data-testid="checkbox-include-journal" />
              Include current journal ({lines.length}) along with imported files ({imported.length})
            </label>
            <p className="font-mono-ui text-[11px] text-[hsl(var(--muted-foreground))]" data-testid="text-upload-count">{uploadCompileError || `${uploadLines.length} lines will be uploaded`}</p>
            <label className="flex items-start gap-2 border border-[hsl(var(--bronze)/.3)] bg-[hsl(var(--ink)/.4)] p-3 text-xs leading-relaxed text-[hsl(var(--parchment)/.9)]">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[hsl(var(--bronze))]" data-testid="checkbox-archive-consent" />
              <span>I agree to send this dialogue text and title to the configured service at <span className="font-mono-ui text-[hsl(var(--bronze-hi))]">{serviceUrl()}</span> for storage. It is not sent until I press Upload.</span>
            </label>
            {uploadError && <p className="alert-ember" role="alert" data-testid="text-upload-error"><CircleHelp size={14} className="shrink-0" />{uploadError}</p>}
            <button type="button" className="btn-bronze" disabled={!canUpload} onClick={upload} data-testid="button-upload-archive">{spin('upload') ?? <UploadCloud size={14} />} {busy === 'upload' ? 'Uploading...' : 'Upload archive'}</button>
            {receipt && (
              <div className="space-y-2 border-2 border-[hsl(var(--bronze)/.6)] bg-[hsl(var(--bronze)/.08)] p-3" data-testid="panel-recovery-receipt">
                <p className="text-xs font-semibold text-[hsl(var(--parchment))]">Archived {receipt.count} lines. This recovery code is shown only once.</p>
                <code className="block break-all border border-[hsl(var(--bronze)/.35)] bg-[hsl(var(--ink)/.7)] px-3 py-2 font-mono-ui text-xs text-[hsl(var(--bronze-hi))] select-all" data-testid="text-recovery-code">{receipt.code}</code>
                <p className="alert-ember"><KeyRound size={14} className="shrink-0" />Anyone with this code can retrieve or delete the archive. Save it outside this app before uninstalling.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost" onClick={() => void copyCode()} data-testid="button-copy-code">{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy code'}</button>
                  <button type="button" className="btn-ghost" onClick={saveReceipt} data-testid="button-save-receipt"><Download size={13} /> Save receipt file</button>
                  <button type="button" className="btn-chip" onClick={() => setReceipt(null)} data-testid="button-dismiss-receipt">I saved it</button>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2.5">
            <div className="rune-label">Retrieve archive</div>
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); retrieve(); }}>
              <input value={code} disabled={!!busy} onChange={(e) => { setCode(e.target.value); setRetrieved(null); setRetrieveError(''); setConfirmDelete(false); }}
                placeholder="64-character recovery code" autoComplete="off" spellCheck={false}
                className="field h-10 min-w-0 flex-1 font-mono-ui text-xs" aria-label="Recovery code" data-testid="input-recovery-code" />
              <button type="submit" className="btn-ghost" disabled={!codeValid || !!busy} data-testid="button-retrieve-archive">{spin('retrieve') ?? <KeyRound size={13} />} Fetch</button>
            </form>
            {cleanCode && !codeValid && <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Codes are exactly 64 hexadecimal characters.</p>}
            {retrieveError && <p className="alert-ember" role="alert" data-testid="text-retrieve-error"><CircleHelp size={14} className="shrink-0" />{retrieveError}</p>}
            {busy === 'retrieve' && <div className="h-24 animate-pulse border border-[hsl(var(--bronze)/.2)] bg-[hsl(var(--ink)/.4)]" />}
            {retrieved && (
              <div className="space-y-2" data-testid="panel-retrieved-archive">
                <p className="text-xs text-[hsl(var(--parchment))]"><span className="font-display font-bold">{retrieved.title}</span> <span className="font-mono-ui text-[11px] text-[hsl(var(--muted-foreground))]">/ {retrieved.lines.length} lines / {new Date(retrieved.createdAt).toLocaleString()}</span></p>
                <Preview lines={retrieved.lines} testId="list-retrieved-preview" />
                <div className="flex flex-wrap items-center gap-2">
                  <FormatPicker value={retrievedFormat} onChange={setRetrievedFormat} id="retrieved" />
                  <button type="button" className="btn-ghost" onClick={() => downloadDialogue(retrieved.lines, retrievedFormat)} data-testid="button-export-retrieved"><Download size={13} /> Export</button>
                  <button type="button" className="btn-bronze" disabled={!!busy} onClick={() => restore(retrieved.lines, 'Archive merged')} data-testid="button-merge-retrieved">Merge into journal</button>
                </div>
              </div>
            )}
            {codeValid && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {confirmDelete ? (
                  <>
                    <span className="text-xs text-[hsl(var(--ember-hi))]">Permanently delete the server archive? Local journal and files stay.</span>
                    <button type="button" className="btn-ghost btn-danger" disabled={!!busy} onClick={remove} data-testid="button-confirm-delete-archive">{spin('delete') ?? <Trash2 size={13} />} Delete permanently</button>
                    <button type="button" className="btn-chip" disabled={!!busy} onClick={() => setConfirmDelete(false)} data-testid="button-cancel-delete-archive">Cancel</button>
                  </>
                ) : (
                  <button type="button" className="btn-chip btn-danger" disabled={!!busy} onClick={() => setConfirmDelete(true)} data-testid="button-delete-archive"><Trash2 size={12} /> Delete server archive</button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
