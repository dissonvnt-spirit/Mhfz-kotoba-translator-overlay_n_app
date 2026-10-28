import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Form } from '@/components/ui/form';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { setBaseUrl, useTranslatePublicGameText } from '@workspace/api-client-react';
import { OfflineTranslator } from '@/lib/offline-translation';
import { TranslationOptions, type TranslationMode } from '@/components/translation-options';
import { isTauri } from '@tauri-apps/api/core';
import { useForm } from 'react-hook-form';
import { createWorker, type Worker } from 'tesseract.js';
import {
  ArrowDown, ArrowUpRight, Captions, Check, ChevronDown, CircleHelp, Copy,
  Gamepad2, Languages, LoaderCircle, Monitor, Pause, Play, Radio, ScanText,
  Settings2, ShieldCheck, Square, Trash2, Volume2, X,
} from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type CaptureState = 'idle' | 'capturing' | 'paused' | 'error';
type DetectedLine = { sourceText: string; translatedText: string; timestamp: number };
type OCRRegion = { x: number; y: number; width: number; height: number };
const STORAGE_KEY = 'kotoba-overlay-lines';
const API_BASE_KEY = 'kotoba-translation-api-base';
const OVERLAY_CHANNEL = 'kotoba-overlay-sync';
const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const MAX_SAVED_LINES = 50;
const DEFAULT_CLOUD_URL = 'https://Mhfzz-game-translator.replit.app';

function Home() {
  const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1';
  const isDesktop = isTauri();
  const translate = useTranslatePublicGameText({ request: { headers: { 'X-Kotoba-Cloud-Consent': 'yes' } } });
  const [translationMode, setTranslationMode] = useState<TranslationMode>('offline');
  const modeRef = useRef<TranslationMode>('offline');
  const localTranslator = useRef<OfflineTranslator | null>(null);
  const [offlineStatus, setOfflineStatus] = useState('Prepare the model once while online. Previously downloaded models load from this device.');
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const manualForm = useForm<{ text: string }>({ defaultValues: { text: '' } });
  const apiForm = useForm<{ url: string }>({
    defaultValues: { url: localStorage.getItem(API_BASE_KEY) || (isDesktop ? DEFAULT_CLOUD_URL : '') },
  });
  const draft = manualForm.watch('text') ?? '';
  const apiBaseUrl = apiForm.watch('url') ?? '';
  const [captureState, setCaptureState] = useState<CaptureState>('idle');
  const [ocrOrientation, setOcrOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [ocrRegion, setOcrRegion] = useState<OCRRegion | null>(null);
  const [draftRegion, setDraftRegion] = useState<OCRRegion | null>(null);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [captureAspect, setCaptureAspect] = useState<number | null>(null);
  const [captureName, setCaptureName] = useState('');
  const [lines, setLines] = useState<DetectedLine[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as DetectedLine[]; } catch { return []; }
  });
  const [captureError, setCaptureError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [ocrStatus, setOcrStatus] = useState('Japanese OCR is ready');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [translationError, setTranslationError] = useState('');
  const [apiSaved, setApiSaved] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const pollRef = useRef<number | null>(null);
  const captureStateRef = useRef<CaptureState>('idle');
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectingRegionRef = useRef(selectingRegion);
  const ocrRegionRef = useRef<OCRRegion | null>(ocrRegion);
  const processingFrameRef = useRef(false);
  const translatingRef = useRef(false);
  const recentTextRef = useRef<string[]>([]);
  const overlayChannelRef = useRef<BroadcastChannel | null>(null);
  selectingRegionRef.current = selectingRegion;
  ocrRegionRef.current = ocrRegion;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    if (!isOverlay) {
      overlayChannelRef.current?.postMessage({ type: 'sync-lines', lines });
    }
  }, [lines]);

  useEffect(() => {
    if (!isOverlay) return;
    const channel = new BroadcastChannel(OVERLAY_CHANNEL);
    overlayChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ type?: string; lines?: DetectedLine[] }>) => {
      if (event.data?.type === 'sync-lines' && Array.isArray(event.data.lines)) {
        setLines(event.data.lines);
      }
    };
    const syncLines = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try { setLines(JSON.parse(event.newValue) as DetectedLine[]); } catch { /* ignore malformed saved state */ }
    };
    window.addEventListener('storage', syncLines);
    return () => {
      window.removeEventListener('storage', syncLines);
      channel.close();
      overlayChannelRef.current = null;
    };
  }, [isOverlay]);

  useEffect(() => {
    if (!isOverlay) {
      const channel = new BroadcastChannel(OVERLAY_CHANNEL);
      overlayChannelRef.current = channel;
      return () => {
        channel.close();
        overlayChannelRef.current = null;
      };
    }
    return undefined;
  }, [isOverlay]);

  useEffect(() => {
    if (autoScroll && !isOverlay) transcriptRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [lines, autoScroll, isOverlay]);

  useEffect(() => {
    document.documentElement.classList.toggle('overlay-mode', isOverlay);
    return () => document.documentElement.classList.remove('overlay-mode');
  }, [isOverlay]);

  useEffect(() => {
    captureStateRef.current = captureState;
  }, [captureState]);

  const getSelectionPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const startRegionSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectingRegion) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getSelectionPoint(event);
    selectionStartRef.current = point;
    setDraftRegion({ ...point, width: 0, height: 0 });
  };

  const moveRegionSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = selectionStartRef.current;
    if (!selectingRegion || !start) return;
    const point = getSelectionPoint(event);
    setDraftRegion({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const finishRegionSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = selectionStartRef.current;
    if (!selectingRegion || !start) return;
    const point = getSelectionPoint(event);
    const nextRegion = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    selectionStartRef.current = null;
    setDraftRegion(null);
    setSelectingRegion(false);
    if (nextRegion.width < 0.04 || nextRegion.height < 0.04) {
      setCaptureError('Draw a larger box around the dialogue area.');
      return;
    }
    setOcrRegion(nextRegion);
    setCaptureError('');
  };

  useEffect(() => {
    setBaseUrl(apiBaseUrl.trim() || null);
  }, []);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) {
        modeRef.current = 'offline';
        setTranslationMode('offline');
      }
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void workerRef.current?.terminate();
    localTranslator.current?.dispose();
    overlayChannelRef.current?.close();
  }, []);

  const changeTranslationMode = (mode: TranslationMode) => {
    modeRef.current = mode;
    setTranslationMode(mode);
    setTranslationError('');
    translate.reset();
    recentTextRef.current = [];
  };

  const prepareOffline = async () => {
    if (translatingRef.current || offlineBusy) return;
    setOfflineBusy(true);
    setOfflineStatus('Preparing local translation. Keep this window open...');
    try {
      localTranslator.current ??= new OfflineTranslator();
      await localTranslator.current.prepare(setOfflineStatus);
      recentTextRef.current = [];
      setOfflineStatus('Local model ready. Translation and Japanese OCR can now run offline on this device.');
    } catch {
      setOfflineStatus('Local setup failed. Check your connection, free disk space and memory, then retry. Downloads already saved are reused.');
    } finally {
      setOfflineBusy(false);
    }
  };

  const translateText = async (text: string, clearDraft = false): Promise<boolean> => {
    if (!text || translatingRef.current || offlineBusy) return false;
    translatingRef.current = true;
    setTranslationBusy(true);
    setTranslationError('');
    try {
      let result: { sourceText: string; translatedText: string };
      if (modeRef.current === 'offline' || !navigator.onLine) {
        localTranslator.current ??= new OfflineTranslator();
        const translatedText = await localTranslator.current.translate(text, setOfflineStatus);
        setOfflineStatus('Local model ready. Dialogue is translated entirely on this device.');
        result = { sourceText: text, translatedText };
      } else {
        result = await translate.mutateAsync({ data: { text } });
      }
      setLines((current) => [{ ...result, timestamp: Date.now() }, ...current].slice(0, MAX_SAVED_LINES));
      if (clearDraft) manualForm.reset({ text: '' });
      return true;
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (modeRef.current === 'offline' || !navigator.onLine) {
        setTranslationError('Local translation could not run. Prepare the local model while online first. If it was downloaded, check free disk space and memory and retry. No dialogue was sent to the cloud.');
      } else if (status === 429) {
        setTranslationError('Free cloud allowance reached. Switch to offline translation or try again later.');
      } else if (status === 503) {
        setTranslationError('Developer-funded cloud translation is unavailable. Please use offline translation.');
      } else {
        setTranslationError('Translation could not be reached. Check your connection and try again.');
      }
      return false;
    } finally {
      translatingRef.current = false;
      setTranslationBusy(false);
    }
  };

  const startCapture = async () => {
    if (offlineBusy) {
      setCaptureError('Wait for local model preparation to finish before starting capture.');
      return;
    }
    setCaptureError('');
    setTranslationError('');
    setOcrProgress(0);
    setOcrRegion(null);
    setDraftRegion(null);
    setSelectingRegion(false);
    setCaptureAspect(null);
    recentTextRef.current = [];
    setOcrStatus('Choose a game window or display...');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      const [track] = stream.getVideoTracks();
      setCaptureName(track?.label || 'Selected display');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
          setCaptureAspect(videoRef.current.videoWidth / videoRef.current.videoHeight);
        }
      }
      track?.addEventListener('ended', () => {
        stopCapture();
      }, { once: true });
      setOcrStatus('Loading Japanese OCR...');
      const worker = await createWorker(ocrOrientation === 'vertical' ? 'jpn_vert' : 'jpn', undefined, {
        workerPath: new URL(`${import.meta.env.BASE_URL}ocr/worker.min.js`, window.location.href).href,
        corePath: new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href,
        langPath: new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href,
        workerBlobURL: false,
        logger: ({ status, progress }) => {
          setOcrStatus(status.replaceAll('_', ' '));
          setOcrProgress(Math.round(progress * 100));
        },
      });
      workerRef.current = worker;
      captureStateRef.current = 'capturing';
      setCaptureState('capturing');
      setOcrStatus('Reading Japanese dialogue automatically');

      pollRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const activeWorker = workerRef.current;
        if (
          captureStateRef.current !== 'capturing' ||
          selectingRegionRef.current ||
          processingFrameRef.current ||
          translatingRef.current ||
          !video ||
          !canvas ||
          !activeWorker ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) return;

        processingFrameRef.current = true;
        try {
          const sourceWidth = video.videoWidth;
          const sourceHeight = video.videoHeight;
          if (!sourceWidth || !sourceHeight) return;
          const region = ocrRegionRef.current;
          const cropX = region ? Math.round(region.x * sourceWidth) : 0;
          const cropY = region ? Math.round(region.y * sourceHeight) : 0;
          const cropWidth = region ? Math.round(region.width * sourceWidth) : sourceWidth;
          const cropHeight = region ? Math.round(region.height * sourceHeight) : sourceHeight;
          if (!cropWidth || !cropHeight) return;
          const scale = region
            ? Math.min(2, 1600 / cropWidth)
            : Math.min(1, 1200 / sourceWidth);
          canvas.width = Math.max(1, Math.round(cropWidth * scale));
          canvas.height = Math.max(1, Math.round(cropHeight * scale));
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return;
          context.filter = 'grayscale(1) contrast(1.12)';
          context.drawImage(
            video,
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          context.filter = 'none';
          const result = await activeWorker.recognize(canvas);
          const detectedText = result.data.text.replace(/[ \t]+/g, ' ').trim().slice(0, 1800);
          if (!JAPANESE_TEXT.test(detectedText) || detectedText.length < 2) return;
          const key = detectedText.replace(/\s+/g, ' ');
          if (recentTextRef.current.includes(key)) return;
          recentTextRef.current = [...recentTextRef.current.slice(-29), key];
          await translateText(detectedText);
        } catch {
          setOcrStatus('OCR paused after a screen-reading error');
        } finally {
          processingFrameRef.current = false;
        }
      }, 2200);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void workerRef.current?.terminate();
      workerRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setCaptureError('Screen sharing was cancelled. Choose a window or display to begin.');
        captureStateRef.current = 'idle';
        setCaptureState('idle');
      } else {
        setCaptureError('Screen capture or Japanese OCR could not start. Check your connection and try again.');
        captureStateRef.current = 'error';
        setCaptureState('error');
      }
    }
  };

  const stopCapture = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    void workerRef.current?.terminate();
    workerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    captureStateRef.current = 'idle';
    setCaptureName('');
    setCaptureState('idle');
    setCaptureError('');
    setOcrStatus('Japanese OCR is ready');
    setOcrProgress(0);
  };

  const submitText = manualForm.handleSubmit(({ text }) => {
    const value = text.trim();
    if (!value || translationBusy || offlineBusy) return;
    if (value.length > 2000) {
      setTranslationError('Enter at most 2000 characters of dialogue.');
      return;
    }
    void translateText(value, true);
  });

  const saveApiBaseUrl = apiForm.handleSubmit(({ url }) => {
    const value = url.trim().replace(/\/+$/, '');
    if (value) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:') throw new Error('invalid protocol');
        setBaseUrl(value);
      } catch {
        setCaptureError('Enter a valid HTTPS URL for the cloud translation service.');
        setApiSaved(false);
        return;
      }
    } else {
      setBaseUrl(null);
    }
    localStorage.setItem(API_BASE_KEY, value);
    apiForm.reset({ url: value });
    setApiSaved(true);
    setCaptureError('');
  });

  const openOverlay = async () => {
    if (!isDesktop) {
      window.open(`${window.location.pathname}?overlay=1`, '_blank', 'noopener,noreferrer');
      return;
    }
    setCaptureError('');
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const label = 'translation-overlay';
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
      }
      const overlay = new WebviewWindow(label, {
        url: 'index.html?overlay=1',
        title: 'MHFZ-Z Translator Overlay - Dialogue',
        width: 480,
        height: 230,
        minWidth: 360,
        minHeight: 170,
        center: true,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: true,
      });
      void overlay.once('tauri://error', (event) => {
        setCaptureError(`The Windows overlay could not open: ${String(event.payload)}`);
      });
    } catch {
      setCaptureError('The Windows overlay could not open. Restart the desktop app and try again.');
    }
  };

  const closeOverlay = async () => {
    if (isDesktop) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } else {
      window.close();
    }
  };

  const copyTranslation = async (line: DetectedLine) => {
    try {
      await navigator.clipboard.writeText(line.translatedText);
      setCopiedId(line.timestamp);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch { /* clipboard access is optional */ }
  };

  const statusLabel = captureState === 'capturing' ? 'On the hunt' : captureState === 'paused' ? 'Paused' : captureState === 'error' ? 'Capture error' : 'At camp';
  const latest = lines[0];

  if (isOverlay) {
    return (
      <main className="min-h-[100dvh] w-full p-3 sm:p-6" data-testid="overlay-view">
        <div className="hunt-frame mx-auto max-w-3xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--bronze)/.35)] px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Crest size={26} />
              <span className="truncate font-display text-[13px] font-bold tracking-[.14em] text-[hsl(var(--parchment))]">MHFZ-Z <span className="text-[hsl(var(--bronze-hi))]">Translator Overlay</span></span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.16em] text-[hsl(var(--parchment)/.65)] sm:flex"><span className="live-pulse h-1.5 w-1.5 rotate-45 bg-[hsl(var(--moss))]" />Live</span>
              <button onClick={() => void closeOverlay()} className="icon-btn" aria-label="Close overlay" data-testid="button-close-overlay"><X size={15} /></button>
            </div>
          </div>
          {latest ? (
            <div className="space-y-2.5 px-5 py-4 sm:px-6 sm:py-5" data-testid="overlay-latest-translation">
              <p className="font-jp text-base leading-relaxed text-[hsl(var(--parchment)/.72)] sm:text-lg" lang="ja">{latest.sourceText}</p>
              <p className="border-l-2 border-[hsl(var(--ember))] pl-3 font-display text-lg font-semibold leading-relaxed text-[hsl(var(--parchment))] sm:text-xl">{latest.translatedText}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-6 text-sm text-[hsl(var(--parchment)/.7)]" data-testid="overlay-empty-state"><Captions size={16} className="shrink-0 text-[hsl(var(--bronze-hi))]" />Japanese dialogue will appear here once the hunt begins.</div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="noise-layer min-h-[100dvh] px-3 py-4 text-[hsl(var(--foreground))] sm:px-6 sm:py-6 lg:px-10">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b-2 border-double border-[hsl(var(--bronze)/.45)] pb-4">
          <div className="flex items-center gap-3">
            <Crest size={46} />
            <div>
              <h1 className="font-display text-lg font-bold leading-none tracking-[.08em] text-[hsl(var(--parchment))] sm:text-xl">MHFZ-Z <span className="text-[hsl(var(--bronze-hi))]">Translator Overlay</span></h1>
              <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">A hunter's field journal for Japanese dialogue. Unofficial fan tool.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className={`flex items-center gap-2 border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.12em] ${captureState === 'capturing' ? 'border-[hsl(var(--moss)/.5)] bg-[hsl(var(--moss)/.12)] text-[hsl(var(--moss-hi))]' : captureState === 'error' ? 'border-[hsl(var(--ember)/.55)] bg-[hsl(var(--ember)/.12)] text-[hsl(var(--ember-hi))]' : 'border-[hsl(var(--bronze)/.35)] text-[hsl(var(--muted-foreground))]'}`} data-testid="status-capture">
              <span className={`h-1.5 w-1.5 rotate-45 ${captureState === 'capturing' ? 'live-pulse bg-[hsl(var(--moss-hi))]' : captureState === 'error' ? 'bg-[hsl(var(--ember-hi))]' : 'bg-[hsl(var(--bronze))]'}`} />
              {statusLabel}
            </div>
            <button onClick={() => void openOverlay()} className="btn-ghost" data-testid="button-open-overlay">
              <ArrowUpRight size={14} /> {isDesktop ? 'Open overlay' : 'Preview overlay'}
            </button>
          </div>
        </header>

        <section className="mb-6 grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
          <div className="hunt-panel relative overflow-hidden p-5 sm:p-6">
            <svg className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 text-[hsl(var(--bronze)/.1)]" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="1" /><circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" /><path d="M50 8 L56 44 L92 50 L56 56 L50 92 L44 56 L8 50 L44 44 Z" fill="currentColor" /></svg>
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="rune-label mb-2"><Monitor size={13} /> Quest target</div>
                <h2 className="break-words font-display text-xl font-bold sm:text-2xl">{captureName || 'Choose a game window'}</h2>
                <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{translationMode === 'offline' ? 'Read and translate Japanese dialogue on your device. Prepare the model once, then play offline without a key.' : 'Cloud mode sends recognized dialogue, not captured frames, to the developer\u2019s service and OpenAI.'}</p>
              </div>
              <div className="flex items-center gap-2 border border-[hsl(var(--moss)/.35)] bg-[hsl(var(--moss)/.08)] px-3 py-2 text-[11px] text-[hsl(var(--moss-hi))]">
                <ShieldCheck size={14} /> Screen stays on your device
              </div>
            </div>
            <div className="relative mt-5 flex flex-wrap items-center gap-2.5">
              {captureState === 'idle' || captureState === 'error' ? (
                <button onClick={startCapture} className="btn-bronze" data-testid="button-select-capture">
                  <Monitor size={15} /> Select game or screen
                </button>
              ) : (
                <>
                  {captureState === 'capturing' ? (
                    <button onClick={() => { captureStateRef.current = 'paused'; setCaptureState('paused'); }} className="btn-bronze" data-testid="button-pause-capture"><Pause size={14} /> Pause capture</button>
                  ) : (
                    <button onClick={() => { captureStateRef.current = 'capturing'; setCaptureState('capturing'); }} className="btn-bronze" data-testid="button-resume-capture"><Play size={14} /> Resume capture</button>
                  )}
                  <button onClick={stopCapture} className="btn-ghost btn-danger" data-testid="button-stop-capture"><Square size={12} /> Stop</button>
                </>
              )}
              <span className="ml-1 flex items-center gap-1.5 font-mono-ui text-[11px] text-[hsl(var(--muted-foreground))]" data-testid="status-ocr"><ScanText size={13} /> {captureState === 'capturing' ? `${ocrStatus}${ocrProgress > 0 && ocrProgress < 100 ? ` ${ocrProgress}%` : ''}` : 'Local Japanese text detection'}</span>
            </div>
            {captureError && <p className="alert-ember relative mt-3" role="alert" data-testid="text-capture-error"><CircleHelp size={14} className="shrink-0" />{captureError}</p>}
            <div className={captureState === 'capturing' || captureState === 'paused' ? 'relative mt-5 space-y-2' : 'fixed -left-[10000px] top-0 h-px w-px overflow-hidden opacity-0'}>
              <div
                className={`relative w-full overflow-hidden border-2 border-[hsl(var(--bronze)/.55)] bg-[hsl(var(--ink))] ${selectingRegion ? 'cursor-crosshair touch-none' : ''}`}
                style={{ aspectRatio: captureAspect || '16 / 9' }}
                onPointerDown={startRegionSelection}
                onPointerMove={moveRegionSelection}
                onPointerUp={finishRegionSelection}
                onPointerCancel={() => {
                  selectionStartRef.current = null;
                  setDraftRegion(null);
                  setSelectingRegion(false);
                }}
                data-testid="capture-preview"
              >
                <video ref={videoRef} className="h-full w-full object-fill" muted playsInline aria-label="Shared game capture preview" />
                {ocrRegion && !selectingRegion && (
                  <div
                    className="pointer-events-none absolute border-2 border-[hsl(var(--bronze-hi))] shadow-[0_0_0_9999px_rgba(10,12,10,.35)]"
                    style={{ left: `${ocrRegion.x * 100}%`, top: `${ocrRegion.y * 100}%`, width: `${ocrRegion.width * 100}%`, height: `${ocrRegion.height * 100}%` }}
                  />
                )}
                {selectingRegion && draftRegion && (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-[hsl(var(--parchment))] shadow-[0_0_0_9999px_rgba(10,12,10,.45)]"
                    style={{ left: `${draftRegion.x * 100}%`, top: `${draftRegion.y * 100}%`, width: `${draftRegion.width * 100}%`, height: `${draftRegion.height * 100}%` }}
                  />
                )}
                {selectingRegion && !draftRegion && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 font-display text-sm font-semibold tracking-wide text-[hsl(var(--parchment))]">Drag around the Japanese dialogue</div>}
              </div>
              {(captureState === 'capturing' || captureState === 'paused') && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-[hsl(var(--muted-foreground))]">{ocrRegion ? 'OCR reads only the highlighted dialogue area.' : 'OCR reads the full shared screen.'}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        selectionStartRef.current = null;
                        setDraftRegion(null);
                        setCaptureError('');
                        setSelectingRegion((value) => !value);
                      }}
                      className="link-bronze"
                      data-testid="button-select-dialogue-region"
                    >
                      {selectingRegion ? 'Cancel area selection' : ocrRegion ? 'Redraw dialogue area' : 'Select dialogue area'}
                    </button>
                    {ocrRegion && <button type="button" onClick={() => { setOcrRegion(null); setSelectingRegion(false); }} className="link-bronze" data-testid="button-reset-dialogue-region">Full screen</button>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="parchment flex flex-col justify-between p-5 sm:p-6">
            <div>
              <div className="rune-label rune-label-dark mb-2"><Gamepad2 size={13} /> Hunt log</div>
              <div className="flex items-end justify-between gap-3">
                <div><div className="font-display text-5xl font-bold leading-none" data-testid="text-line-count">{lines.length.toString().padStart(2, '0')}</div><p className="mt-2 text-xs font-medium">translated lines recorded</p></div>
                <div className="mb-1 flex items-center gap-1.5 text-right text-[11px] font-semibold">Japanese <ArrowDown size={12} /> English</div>
              </div>
            </div>
            <div className="mt-5 border-t border-dashed border-[hsl(var(--ink)/.35)] pt-3 text-[11px] leading-relaxed">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold uppercase tracking-[.12em]">Engine</span><span className="font-mono-ui" data-testid="text-active-engine">{translationMode === 'offline' ? 'On-device \u00b7 Japanese \u2192 English' : 'Cloud \u00b7 OpenAI GPT-5 mini'}</span></div>
            </div>
          </div>
        </section>

        <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="hunt-panel min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--bronze)/.3)] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 rotate-45 items-center justify-center border border-[hsl(var(--bronze)/.6)] bg-[hsl(var(--bronze)/.12)] text-[hsl(var(--bronze-hi))]"><Captions size={16} className="-rotate-45" /></div>
                <div><h2 className="font-display text-base font-bold">Dialogue journal</h2><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Most recent first <span className="mx-1 opacity-50">/</span> {lines.length} {lines.length === 1 ? 'line' : 'lines'}</p></div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setAutoScroll((value) => !value)} aria-pressed={autoScroll} className={`btn-chip ${autoScroll ? 'btn-chip-on' : ''}`} data-testid="button-toggle-follow"><ArrowDown size={12} /> Follow</button>
                <button onClick={() => setLines([])} disabled={!lines.length} className="btn-chip btn-danger" data-testid="button-clear-transcript"><Trash2 size={12} /> Clear</button>
              </div>
            </div>
            <div ref={transcriptRef} className="max-h-[440px] min-h-[260px] overflow-y-auto scroll-smooth">
              {translationBusy && (
                <div className="border-b border-[hsl(var(--bronze)/.18)] px-5 py-5" data-testid="status-translating">
                  <div className="mb-3 flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.16em] text-[hsl(var(--bronze-hi))]"><LoaderCircle size={12} className="animate-spin" />Translating</div>
                  <div className="h-3 w-2/3 animate-pulse bg-[hsl(var(--parchment)/.1)]" /><div className="mt-3 h-3 w-1/2 animate-pulse bg-[hsl(var(--parchment)/.07)]" />
                </div>
              )}
              {(translationError || translate.isError) && <div className="alert-ember mx-5 my-4" role="alert" data-testid="status-translation-error"><CircleHelp size={14} className="shrink-0" />{translationError || 'Translation failed. Submit the line again to retry.'}</div>}
              {lines.length ? lines.map((line, index) => (
                <article key={line.timestamp} className={`group border-b border-[hsl(var(--bronze)/.15)] px-5 py-5 transition-colors hover:bg-[hsl(var(--bronze)/.05)] ${index === 0 ? 'rise-in' : ''}`} data-testid={`card-translation-${line.timestamp}`}>
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]"><span className="h-1.5 w-1.5 rotate-45 bg-[hsl(var(--bronze))]" />{new Date(line.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <button onClick={() => copyTranslation(line)} className="btn-chip opacity-60 group-hover:opacity-100 focus-visible:opacity-100" data-testid={`button-copy-translation-${line.timestamp}`} aria-label="Copy translation">{copiedId === line.timestamp ? <Check size={12} /> : <Copy size={12} />}{copiedId === line.timestamp ? 'Copied' : 'Copy'}</button>
                  </div>
                  <p className="font-jp text-[15px] leading-[1.85] text-[hsl(var(--parchment)/.8)]" lang="ja" data-testid={`text-source-${line.timestamp}`}>{line.sourceText}</p>
                  <p className="mt-2 border-l-2 border-[hsl(var(--ember))] pl-3 text-[15px] leading-relaxed text-[hsl(var(--parchment))]" data-testid={`text-translation-${line.timestamp}`}>{line.translatedText}</p>
                </article>
              )) : (
                <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-10 text-center" data-testid="empty-transcript">
                  <Crest size={60} muted />
                  <h3 className="mt-4 font-display text-base font-bold text-[hsl(var(--parchment))]">The journal is blank</h3>
                  <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Select a game capture to detect and translate Japanese dialogue automatically, or enter a line below.</p>
                </div>
              )}
            </div>
            <Form {...manualForm}>
            <form onSubmit={submitText} className="border-t-2 border-double border-[hsl(var(--bronze)/.4)] bg-[hsl(var(--ink)/.5)] p-4 sm:px-5">
              <label htmlFor="dialogue-input" className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--bronze-hi))]"><span>Translate a line</span><span className="font-mono-ui normal-case tracking-normal text-[hsl(var(--muted-foreground))]">Japanese to English</span></label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id="dialogue-input" {...manualForm.register('text', { maxLength: 2000 })} value={draft} maxLength={2000} placeholder="Paste or type Japanese dialogue..." className="field h-11 min-w-0 flex-1 font-jp text-sm" data-testid="input-dialogue" />
                <button type="submit" disabled={!draft.trim() || translationBusy || offlineBusy} className="btn-bronze h-11 justify-center" data-testid="button-translate"><Languages size={14} /> Translate</button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><span>Manual translation works alongside automatic capture.</span><span className="font-mono-ui">{draft.length}/2000</span></div>
            </form>
            </Form>
          </div>

          <aside className="space-y-4">
            <div className="hunt-panel p-5">
              <div className="rune-label mb-4"><Settings2 size={14} /> Loadout</div>
              <div className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-[hsl(var(--bronze)/.15)] pb-3.5">
                  <div className="flex items-center gap-2.5"><span className="slot-icon"><Languages size={14} /></span><div><p className="text-xs font-semibold">Language pair</p><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Source and target</p></div></div>
                  <span className="flex items-center gap-1 text-[11px]">JA <ChevronDown size={12} /></span>
                </div>
                <div className="flex items-center justify-between border-b border-[hsl(var(--bronze)/.15)] pb-3.5">
                  <div className="flex items-center gap-2.5"><span className="slot-icon"><Radio size={14} /></span><div><p className="text-xs font-semibold">Capture mode</p><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Share a game window</p></div></div>
                  <span className="border border-[hsl(var(--bronze)/.3)] px-2 py-1 text-[10px]">Window</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--bronze)/.15)] pb-3.5">
                  <div><label htmlFor="ocr-orientation" className="text-xs font-semibold">Japanese text layout</label><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">How dialogue is arranged</p></div>
                  <select
                    id="ocr-orientation"
                    value={ocrOrientation}
                    onChange={(event) => setOcrOrientation(event.target.value as 'horizontal' | 'vertical')}
                    disabled={captureState !== 'idle' && captureState !== 'error'}
                    className="field px-2 py-1.5 text-[11px] disabled:opacity-50"
                    data-testid="select-ocr-orientation"
                  >
                    <option value="horizontal">Horizontal</option>
                    <option value="vertical">Vertical</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5"><span className="slot-icon"><Volume2 size={14} /></span><div><p className="text-xs font-semibold">Overlay preview</p><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Transparent companion view</p></div></div>
                  <button onClick={() => void openOverlay()} className="btn-chip" data-testid="button-preview-overlay">{isDesktop ? 'Open' : 'Preview'} <ArrowUpRight size={11} /></button>
                </div>
              </div>
              <div className="mt-5"><TranslationOptions mode={translationMode} onModeChange={changeTranslationMode} offlineStatus={offlineStatus} offlineBusy={offlineBusy} onPrepareOffline={() => void prepareOffline()} online={online} busy={translationBusy} /></div>
              {translationMode === 'cloud' && <Form {...apiForm}>
              <form onSubmit={saveApiBaseUrl} className="mt-4 border-t border-[hsl(var(--bronze)/.25)] pt-4">
                <label htmlFor="translation-api-url" className="mb-2 block text-[11px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--bronze-hi))]">Translation service URL</label>
                <div className="flex gap-2">
                  <input
                    id="translation-api-url"
                    type="url"
                    {...apiForm.register('url', { onChange: () => setApiSaved(false) })}
                    value={apiBaseUrl}
                    placeholder={isDesktop ? 'https://your-published-app.replit.app' : 'Optional for this preview'}
                    className="field h-9 min-w-0 flex-1 px-2.5 text-[11px]"
                    data-testid="input-translation-api-url"
                  />
                  <button type="submit" className="btn-ghost h-9" data-testid="button-save-api-url">Save</button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">No API key or service token needed. {isDesktop ? 'The developer\u2019s published service is preconfigured.' : 'Leave the URL blank to use this preview\u2019s service.'} Your cloud choice lasts only for this app session. {apiSaved && <span className="text-[hsl(var(--moss-hi))]" data-testid="status-api-saved">Settings saved</span>}</p>
              </form>
              </Form>}
            </div>
            <div className="parchment p-5">
              <div className="rune-label rune-label-dark mb-3"><ShieldCheck size={14} /> Camp rules</div>
              <p className="text-[12.5px] leading-[1.7]">{translationMode === 'offline' ? 'Captured frames and dialogue stay on your device. Local translation never calls the cloud service.' : 'You opted into cloud translation. Only recognized dialogue is sent to the developer\u2019s service and OpenAI; captured frames stay on your device.'}</p>
              <div className="mt-4 flex items-center gap-2 border-t border-dashed border-[hsl(var(--ink)/.35)] pt-3 font-mono-ui text-[10px] tracking-[.05em]"><span className="h-1.5 w-1.5 rotate-45 bg-[hsl(var(--ink))]" /> No game files modified</div>
            </div>
            <div className="flex items-start gap-2.5 px-1 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]"><CircleHelp size={13} className="mt-0.5 shrink-0" /><p>For the overlay to appear over a game, use the Windows desktop build. Borderless-window mode is recommended for fullscreen games.</p></div>
          </aside>
        </section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t-2 border-double border-[hsl(var(--bronze)/.35)] pt-4 text-[11px] text-[hsl(var(--muted-foreground))]">
          <span className="font-mono-ui tracking-[.08em]">MHFZ-Z TRANSLATOR OVERLAY <span className="mx-1 opacity-50">/</span> Fan-made, not affiliated with Capcom</span>
          <button onClick={() => void openOverlay()} className="link-bronze inline-flex items-center gap-1" data-testid="button-overlay-mode">Overlay window <ArrowUpRight size={11} /></button>
        </footer>
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </main>
  );
}

function Crest({ size = 40, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={`shrink-0 ${muted ? 'opacity-60' : ''}`}>
      <path d="M32 3 L58 14 V32 C58 46 46 56 32 61 C18 56 6 46 6 32 V14 Z" fill="hsl(var(--ink))" stroke="hsl(var(--bronze))" strokeWidth="2.5" />
      <path d="M32 9 L52 18 V32 C52 43 43 51 32 55 C21 51 12 43 12 32 V18 Z" fill="none" stroke="hsl(var(--bronze) / .45)" strokeWidth="1" />
      <path d="M22 44 C24 34 26 26 30 18 M30 46 C32 36 33 28 36 19 M38 44 C39 36 41 29 44 22" stroke="hsl(var(--parchment))" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M32 3 L35 8 L32 11 L29 8 Z" fill="hsl(var(--ember))" />
    </svg>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/index.html" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
