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
    `flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d5a34d]/60 ${active ? 'border-[#d5a34d]/45 bg-[#d5a34d]/[.08]' : 'border-white/10 bg-white/[.02] hover:border-[#d5a34d]/30'}`;

  return (
    <section className="rounded-2xl border border-white/[.09] bg-[#1a1d24] p-5 sm:p-6" aria-labelledby={`${titleId}-section`} data-testid="translation-options">
      <div id={`${titleId}-section`} className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[#d5a34d]"><Cpu size={13} /> Translation engine</div>
      <div role="radiogroup" aria-label="Translation mode" className="grid gap-3">
        <button type="button" role="radio" aria-checked={mode === 'offline'} disabled={busy} onClick={chooseOffline} className={card(mode === 'offline')} data-testid="button-mode-offline">
          <WifiOff size={16} className="mt-0.5 shrink-0 text-[#75c5a6]" />
          <span>
            <span className="block text-sm font-semibold text-[#e9e7df]">On-device <span className="ml-1 font-mono-ui text-[9px] uppercase tracking-[.16em] text-[#75c5a6]">Default</span></span>
            <span className="mt-1 block text-xs leading-relaxed text-[#9a9ba0]">Translates on this computer. Nothing leaves your device once the model is ready.</span>
          </span>
        </button>
        <button ref={cloudButtonRef} type="button" role="radio" aria-checked={mode === 'cloud'} aria-haspopup="dialog" disabled={busy} onClick={chooseCloud} className={card(mode === 'cloud')} data-testid="button-mode-cloud">
          <Cloud size={16} className="mt-0.5 shrink-0 text-[#d5a34d]" />
          <span>
            <span className="block text-sm font-semibold text-[#e9e7df]">Cloud (OpenAI) <span className="ml-1 font-mono-ui text-[9px] uppercase tracking-[.16em] text-[#d5a34d]">Optional</span></span>
            <span className="mt-1 block text-xs leading-relaxed text-[#9a9ba0]">Funded by the developer. Requires internet and your consent.{!online && ' You are offline right now.'}</span>
          </span>
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-white/[.07] bg-black/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-mono-ui text-[11px] text-[#b0b1b1]" role="status" aria-live="polite" data-testid="status-offline-model">
            {offlineBusy && <LoaderCircle size={13} className="animate-spin text-[#d5a34d]" aria-hidden="true" />}
            {offlineStatus}
          </p>
          <button type="button" onClick={onPrepareOffline} disabled={offlineBusy || busy} aria-busy={offlineBusy} className="flex h-9 items-center gap-2 rounded-lg bg-[#d5a34d] px-3.5 text-xs font-semibold text-[#1d1d1b] transition-colors hover:bg-[#e3b766] disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-prepare-offline">
            <Download size={14} /> {offlineBusy ? 'Preparing…' : 'Prepare local model'}
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[#8f9296]">The first download needs internet. Allow a few hundred MB of free disk space for setup. Translation then uses your RAM and CPU and works offline afterwards.{!online && ' Connect to the internet to download it.'}</p>
      </div>

      {consentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) closeConsent(); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className="w-full max-w-md rounded-2xl border border-[#d5a34d]/25 bg-[#202127] p-6 text-[#e9e7df] shadow-2xl" data-testid="dialog-cloud-consent">
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-lg font-semibold tracking-[-.02em]">Use cloud translation?</h2>
              <button type="button" onClick={closeConsent} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white"><X size={14} /></button>
            </div>
            <ul id={descId} className="mt-4 space-y-2.5 text-sm leading-relaxed text-[#b4b5b6]">
              <li>Requests use the developer's OpenAI key, held on the server. It is never given or shown to players.</li>
              <li>Recognized Japanese dialogue text is sent to the operator's service and to OpenAI. Captured screen frames are not sent.</li>
              <li>An internet connection is required.</li>
              <li>Free to use, subject to usage quotas.</li>
              <li>There is no automatic cloud fallback: Kotoba only uses the cloud while you keep this mode on. You can switch back to on-device at any time.</li>
            </ul>
            <p className="mt-4 flex items-center gap-2 text-xs text-[#75c5a6]"><ShieldCheck size={13} /> Your screen still stays on your device.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button ref={cancelRef} type="button" onClick={closeConsent} className="h-9 rounded-lg border border-white/10 px-3.5 text-xs text-[#c2c1bc] hover:border-white/25" data-testid="button-cancel-cloud">Cancel</button>
              <button type="button" onClick={confirmCloud} disabled={busy} className="h-9 rounded-lg bg-[#d5a34d] px-4 text-xs font-semibold text-[#1d1d1b] hover:bg-[#e3b766] disabled:opacity-50" data-testid="button-confirm-cloud">Agree and use cloud</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
