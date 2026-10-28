import { useState, type MouseEvent, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Captions, Grip, Move, X } from 'lucide-react';

const resizeDirections = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const;

export function OverlayWindow({ desktop, crest, latest }: {
  desktop: boolean;
  crest: ReactNode;
  latest?: { sourceText: string; translatedText: string };
}) {
  const [error, setError] = useState('');

  const nativeDrag = (event: MouseEvent, direction?: typeof resizeDirections[number]) => {
    if (!desktop || event.button !== 0) return;
    event.preventDefault();
    setError('');
    const nativeWindow = getCurrentWindow();
    void (direction ? nativeWindow.startResizeDragging(direction) : nativeWindow.startDragging())
      .catch(() => setError(`Could not ${direction ? 'resize' : 'move'} the overlay. Close and reopen it from the main window, then try again.`));
  };

  const close = async () => {
    try {
      // Only this secondary window closes. Capture belongs to the main window.
      if (desktop) await getCurrentWindow().close();
      else window.close();
    } catch {
      setError('Could not close the overlay. Try again; keep the main window open to continue capture.');
    }
  };

  return (
    <main className="overlay-shell" data-testid="overlay-view">
      <div className="hunt-frame overlay-panel">
        <header className="overlay-toolbar">
          <button type="button" className="overlay-move" onMouseDown={(event) => nativeDrag(event)}
            disabled={!desktop} aria-label="Move overlay" title="Hold and drag to move the overlay" data-testid="overlay-drag-handle">
            {crest}
            <span className="truncate font-display text-[13px] font-bold tracking-[.1em]">MHFZ-Z Translator Overlay</span>
            <Move size={15} className="shrink-0" />
          </button>
          <button type="button" onClick={() => void close()} className="icon-btn shrink-0"
            aria-label="Close overlay" title="Close overlay only; capture continues in the main window" data-testid="button-close-overlay"><X size={15} /></button>
        </header>
        <div className="overlay-content">
          {latest ? (
            <div className="space-y-2.5" data-testid="overlay-latest-translation">
              <p className="font-jp text-base leading-relaxed text-[hsl(var(--parchment)/.72)]" lang="ja">{latest.sourceText}</p>
              <p className="border-l-2 border-[hsl(var(--ember))] pl-3 font-display text-lg font-semibold leading-relaxed">{latest.translatedText}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm text-[hsl(var(--parchment)/.7)]" data-testid="overlay-empty-state">
              <Captions size={16} className="shrink-0 text-[hsl(var(--bronze-hi))]" />Japanese dialogue will appear here once the hunt begins.
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-[hsl(var(--ember-hi))]">{error}</p>}
        </div>
        <footer className="overlay-help">{desktop ? 'Drag title to move · Drag edges or corners to resize' : 'Windows app: movable, resizable, always on top'}</footer>
      </div>
      {desktop && resizeDirections.map((direction) => (
        <div key={direction} className={`overlay-resize overlay-resize-${direction}`}
          onMouseDown={(event) => nativeDrag(event, direction)}
          title={`Drag to resize (${direction})`} data-testid={`overlay-resize-${direction}`} aria-hidden="true">
          {direction === 'SouthEast' && <Grip size={16} />}
        </div>
      ))}
    </main>
  );
}
