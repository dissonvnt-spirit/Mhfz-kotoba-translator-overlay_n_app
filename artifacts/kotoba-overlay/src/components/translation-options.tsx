import { useEffect, useId, useRef, useState } from 'react';
import { Cloud, Cpu, Download, LoaderCircle, ShieldCheck, WifiOff, X } from 'lucide-react';

export type TranslationMode = 'offline' | 'cloud';

export interface TranslationOptionsProps {
  mode: TranslationMode;
  onModeChange: (mode: TranslationMode) => void;
  offlineStatus: string;
  offlineBusy: boolean;
  onPrepareOffline: () => void;
  online: boolean;
  busy: boolean;
}

export function TranslationOptions({ mode, onModeChange, offlineStatus, offlineBusy, onPrepareOffline, online, busy }: TranslationOptionsProps) {
  const [consentOpen, setConsentOpen] = useState(false);
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cloudButtonRef = useRef<HTMLButtonElement>(null);

  const closeConsent = () => {
    setConsentOpen(false);
    window.setTimeout(() => cloudButtonRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!consentOpen) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeConsent(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [consentOpen]);

  const chooseOffline = () => { if (!busy && mode !== 'offline') onModeChange('offline'); };
  const chooseCloud = () => { if (!busy && mode !== 'cloud') setConsentOpen(true); };
  const confirmCloud = () => { if (busy) return; onModeChange('cloud'); closeConsent(); };

  const card = (active: boolean) =>
    `flex w-full items-start gap-3 border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-[hsl(var(--bronze-hi))] bg-[hsl(var(--bronze)/.14)] shadow-[inset_3px_0_0_hsl(var(--ember))]' : 'border-[hsl(var(--bronze)/.25)] bg-[hsl(var(--ink)/.35)] hover:border-[hsl(var(--bronze)/.6)]'}`;

  return (
    <section aria-labelledby={`${titleId}-section`} data-testid="translation-options">
      <div id={`${titleId}-section`} className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.2em] text-[hsl(var(--bronze-hi))]"><Cpu size={13} /> Translation engine</div>
      <div role="radiogroup" aria-label="Translation mode" className="grid gap-3">
        <button type="button" role="radio" aria-checked={mode === 'offline'} disabled={busy} onClick={chooseOffline} className={card(mode === 'offline')} data-testid="button-mode-offline">
          <WifiOff size={16} className="mt-0.5 shrink-0 text-[hsl(var(--moss-hi))]" />
          <span>
            <span className="block text-sm font-semibold text-[hsl(var(--parchment))]">On-device <span className="ml-1 font-mono-ui text-[9px] uppercase tracking-[.16em] text-[hsl(var(--moss-hi))]">Default</span></span>
            <span className="mt-1 block text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Translates on this computer. Nothing leaves your device once the model is ready.</span>
          </span>
        </button>
        <button ref={cloudButtonRef} type="button" role="radio" aria-checked={mode === 'cloud'} aria-haspopup="dialog" disabled={busy} onClick={chooseCloud} className={card(mode === 'cloud')} data-testid="button-mode-cloud">
          <Cloud size={16} className="mt-0.5 shrink-0 text-[hsl(var(--bronze-hi))]" />
          <span>
            <span className="block text-sm font-semibold text-[hsl(var(--parchment))]">Cloud (OpenAI) <span className="ml-1 font-mono-ui text-[9px] uppercase tracking-[.16em] text-[hsl(var(--bronze-hi))]">Optional</span></span>
            <span className="mt-1 block text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Funded by the developer. Requires internet and your consent.{!online && ' You are offline right now.'}</span>
          </span>
        </button>
      </div>

      <div className="mt-4 border border-dashed border-[hsl(var(--bronze)/.3)] bg-[hsl(var(--ink)/.35)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-mono-ui text-[11px] text-[hsl(var(--parchment)/.85)]" role="status" aria-live="polite" data-testid="status-offline-model">
            {offlineBusy && <LoaderCircle size={13} className="animate-spin text-[hsl(var(--bronze-hi))]" aria-hidden="true" />}
            {offlineStatus}
          </p>
          <button type="button" onClick={onPrepareOffline} disabled={offlineBusy || busy} aria-busy={offlineBusy} className="btn-bronze h-9" data-testid="button-prepare-offline">
            <Download size={14} /> {offlineBusy ? 'Preparing...' : 'Prepare local model'}
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">The first download needs internet. Allow a few hundred MB of free disk space for setup. Translation then uses your RAM and CPU and works offline afterwards.{!online && ' Connect to the internet to download it.'}</p>
      </div>

      {consentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--ink)/.8)] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) closeConsent(); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className="hunt-frame w-full max-w-md p-6 text-[hsl(var(--parchment))]" data-testid="dialog-cloud-consent">
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="font-display text-xl font-bold">Use cloud translation?</h2>
              <button type="button" onClick={closeConsent} aria-label="Close" className="icon-btn"><X size={14} /></button>
            </div>
            <ul id={descId} className="mt-4 list-disc space-y-2.5 pl-4 text-sm marker:text-[hsl(var(--ember))] leading-relaxed text-[hsl(var(--parchment)/.85)]">
              <li>Requests use the developer's OpenAI key, held on the server. It is never given or shown to players.</li>
              <li>Recognized Japanese dialogue text is sent to the operator's service and to OpenAI. Captured screen frames are not sent.</li>
              <li>An internet connection is required.</li>
              <li>Free to use, subject to usage quotas.</li>
              <li>There is no automatic cloud fallback: MHFZ-Z Translator Overlay only uses the cloud while you keep this mode on. You can switch back to on-device at any time.</li>
            </ul>
            <p className="mt-4 flex items-center gap-2 text-xs text-[hsl(var(--moss-hi))]"><ShieldCheck size={13} /> Your screen still stays on your device.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button ref={cancelRef} type="button" onClick={closeConsent} className="btn-ghost h-9" data-testid="button-cancel-cloud">Cancel</button>
              <button type="button" onClick={confirmCloud} disabled={busy} className="btn-bronze h-9" data-testid="button-confirm-cloud">Agree and use cloud</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
