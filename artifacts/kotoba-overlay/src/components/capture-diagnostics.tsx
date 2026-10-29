export interface CaptureEvidence {
  stage: string;
  source: string;
  crop: string;
  frames: number;
  confidence: number | null;
}

export function CaptureDiagnostics({ evidence, japanese }: {
  evidence: CaptureEvidence; japanese: string;
}) {
  return (
    <div className="relative mt-4 border border-[hsl(var(--bronze)/.3)] bg-black/15 p-3 text-xs" data-testid="capture-diagnostics" aria-live="polite">
      <p className="font-semibold text-[hsl(var(--bronze-hi))]">Capture → Japanese OCR → Translation</p>
      <p className="mt-1 text-[hsl(var(--muted-foreground))]" data-testid="capture-stage">{evidence.stage}</p>
      <p className="mt-2 break-words font-mono-ui text-[11px] text-[hsl(var(--muted-foreground))]">
        Source: {evidence.source || 'waiting'} · OCR crop: {evidence.crop || 'waiting'} · Frames read: {evidence.frames}
        {evidence.confidence !== null ? ` · OCR confidence: ${Math.round(evidence.confidence)}% (not measured accuracy)` : ''}
      </p>
      {japanese && <div className="mt-3 border-t border-[hsl(var(--bronze)/.2)] pt-2">
        <p className="font-semibold">Last recognized Japanese <span className="font-normal text-[hsl(var(--muted-foreground))]">(shown even if translation fails)</span></p>
        <p className="font-jp mt-1 whitespace-pre-wrap break-words leading-relaxed" data-testid="text-recognized-japanese">{japanese}</p>
        <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Dialogue must remain stable for 3 seconds before one translation attempt. Only translations you mark Correct are saved.</p>
      </div>}
    </div>
  );
}
