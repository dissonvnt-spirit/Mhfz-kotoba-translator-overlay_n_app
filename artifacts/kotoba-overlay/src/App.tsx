import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Form } from '@/components/ui/form';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { setAuthTokenGetter, setBaseUrl, useTranslateGameText } from '@workspace/api-client-react';
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

function Home() {
  const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1';
  const isDesktop = isTauri();
  const translate = useTranslateGameText();
  const manualForm = useForm<{ text: string }>({ defaultValues: { text: '' } });
  const apiForm = useForm<{ url: string; token: string }>({
    defaultValues: { url: localStorage.getItem(API_BASE_KEY) || '', token: '' },
  });
  const draft = manualForm.watch('text') ?? '';
  const apiBaseUrl = apiForm.watch('url') ?? '';
  const tokenDraft = apiForm.watch('token') ?? '';
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
  const [serviceTokenSet, setServiceTokenSet] = useState(false);
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
  const serviceTokenRef = useRef('');
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
    if (isOverlay) return;
    setAuthTokenGetter(() => serviceTokenRef.current || null);
    return () => setAuthTokenGetter(null);
  }, [isOverlay]);

  useEffect(() => () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void workerRef.current?.terminate();
    overlayChannelRef.current?.close();
  }, []);

  const translateText = async (text: string, clearDraft = false) => {
    if (!text || translatingRef.current) return;
    if (!serviceTokenRef.current) {
      setTranslationError('Enter the service access token in Session setup before translating.');
      return;
    }
    translatingRef.current = true;
    setTranslationError('');
    try {
      const result = await translate.mutateAsync({ data: { text } });
      setLines((current) => [{ ...result, timestamp: Date.now() }, ...current].slice(0, MAX_SAVED_LINES));
      if (clearDraft) manualForm.reset({ text: '' });
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 401) {
        setTranslationError('The service token was rejected. Check it matches KOTOBA_API_TOKEN on the server.');
      } else if (status === 429) {
        setTranslationError('Translation request limit reached. Wait a moment and try again.');
      } else if (status === 503) {
        setTranslationError('The translation service is not configured yet. Check its project Secrets.');
      } else {
        setTranslationError('Translation could not be reached. Check your connection and try again.');
      }
    } finally {
      translatingRef.current = false;
    }
  };

  const startCapture = async () => {
    if (!serviceTokenRef.current) {
      setCaptureError('Enter the service access token in Session setup before starting capture.');
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
    setOcrStatus('Choose a game window or display…');
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
      setOcrStatus('Loading Japanese OCR…');
      const worker = await createWorker(ocrOrientation === 'vertical' ? 'jpn_vert' : 'jpn', undefined, {
        workerPath: new URL(`${import.meta.env.BASE_URL}ocr/worker.min.js`, window.location.href).href,
        corePath: new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href,
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
    if (!value || translate.isPending) return;
    void translateText(value, true);
  });

  const saveApiBaseUrl = apiForm.handleSubmit(({ url, token }) => {
    const value = url.trim().replace(/\/+$/, '');
    if (value) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('invalid protocol');
        setBaseUrl(value);
      } catch {
        setCaptureError('Enter a valid http or https URL for the published translation service.');
        setApiSaved(false);
        return;
      }
    } else {
      setBaseUrl(null);
    }
    localStorage.setItem(API_BASE_KEY, value);
    if (token.trim()) {
      serviceTokenRef.current = token.trim();
      setServiceTokenSet(true);
    }
    apiForm.reset({ url: value, token: '' });
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
        title: 'Kotoba Translation Overlay',
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

  const statusLabel = captureState === 'capturing' ? 'Capturing' : captureState === 'paused' ? 'Paused' : captureState === 'error' ? 'Capture error' : 'Ready when you are';
  const latest = lines[0];

  if (isOverlay) {
    return (
      <main className="min-h-[100dvh] w-full p-4 sm:p-7" data-testid="overlay-view">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-white/15 bg-[#141820]/90 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#d5a34d] text-[#17191c]"><Languages size={15} /></span>
              <span className="text-xs font-semibold tracking-[.15em] text-[#d9d9d4]">KOTOBA <span className="text-[#d5a34d]">OVERLAY</span></span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.16em] text-white/50"><span className="h-1.5 w-1.5 rounded-full bg-[#69c5a8]" />Live translation</span>
              <button onClick={() => void closeOverlay()} className="flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close overlay" data-testid="button-close-overlay"><X size={14} /></button>
            </div>
          </div>
          {latest ? (
            <div className="space-y-3 px-6 py-5" data-testid="overlay-latest-translation">
              <p className="font-jp text-lg leading-relaxed text-white/60">{latest.sourceText}</p>
              <p className="text-xl font-medium leading-relaxed text-[#f2d49b]">{latest.translatedText}</p>
            </div>
          ) : (
            <div className="px-6 py-7 text-sm text-white/55" data-testid="overlay-empty-state">Japanese dialogue will appear here.</div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="noise-layer min-h-[100dvh] px-4 py-5 text-[#e9e7df] sm:px-7 sm:py-7 lg:px-10">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/[.08] pb-5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#d5a34d]/30 bg-[#d5a34d]/10 text-[#d5a34d]">
              <Languages size={20} strokeWidth={1.8} />
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#1b1e25] bg-[#6cc5a4]" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-bold tracking-[.16em]">KOTOBA</span>
                <span className="font-mono-ui text-[9px] tracking-[.19em] text-[#d5a34d]">OVERLAY</span>
              </div>
              <p className="mt-0.5 text-xs text-[#90949a]">Japanese, without leaving the game.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] ${captureState === 'capturing' ? 'border-[#65bb9d]/25 bg-[#65bb9d]/[.08] text-[#86d4b6]' : captureState === 'error' ? 'border-[#d67a6e]/30 bg-[#d67a6e]/[.08] text-[#e89a8f]' : 'border-white/10 bg-white/[.025] text-[#a1a3a5]'}`} data-testid="status-capture">
              <span className={`h-1.5 w-1.5 rounded-full ${captureState === 'capturing' ? 'live-pulse bg-[#76d5b1]' : captureState === 'error' ? 'bg-[#e38a7b]' : 'bg-[#858b90]'}`} />
              {statusLabel}
            </div>
            <button onClick={() => void openOverlay()} className="flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-[#c1c1bc] transition-colors hover:border-[#d5a34d]/40 hover:text-[#f1d39b]" data-testid="button-open-overlay">
              <ArrowUpRight size={14} /> {isDesktop ? 'Open overlay' : 'Preview overlay'}
            </button>
          </div>
        </header>

        <section className="mb-7 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
          <div className="relative overflow-hidden rounded-2xl border border-[#d5a34d]/20 bg-[#202127] p-5 sm:p-6">
            <div className="pointer-events-none absolute -right-7 -top-16 h-52 w-52 rounded-full border border-[#d5a34d]/[.08]" />
            <div className="pointer-events-none absolute -right-1 -top-10 h-40 w-40 rounded-full border border-[#d5a34d]/[.08]" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[#d5a34d]"><Monitor size={13} /> Capture source</div>
                <h1 className="text-xl font-semibold tracking-[-.03em] sm:text-2xl">{captureName || 'Choose a game window'}</h1>
                <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-[#9a9ba0]">{captureState === 'capturing' ? 'Japanese text is read on your device. Only detected dialogue is sent to the translation service.' : 'Share a game window or display. Kotoba reads Japanese dialogue locally and translates new lines as they appear.'}</p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-white/[.08] bg-black/10 px-3 py-2 text-[11px] text-[#b0b1b1]">
                <ShieldCheck size={14} className="text-[#75c5a6]" /> Screen stays on your device
              </div>
            </div>
            <div className="relative mt-5 flex flex-wrap items-center gap-2.5">
              {captureState === 'idle' || captureState === 'error' ? (
                <button onClick={startCapture} className="flex h-10 items-center gap-2 rounded-lg bg-[#d5a34d] px-4 text-xs font-semibold text-[#1d1d1b] transition-all hover:bg-[#e3b766] active:scale-[.98]" data-testid="button-select-capture">
                  <Monitor size={15} /> Select game or screen
                </button>
              ) : (
                <>
                  {captureState === 'capturing' ? (
                    <button onClick={() => { captureStateRef.current = 'paused'; setCaptureState('paused'); }} className="flex h-10 items-center gap-2 rounded-lg bg-[#d5a34d] px-4 text-xs font-semibold text-[#1d1d1b] hover:bg-[#e3b766]" data-testid="button-pause-capture"><Pause size={14} /> Pause capture</button>
                  ) : (
                    <button onClick={() => { captureStateRef.current = 'capturing'; setCaptureState('capturing'); }} className="flex h-10 items-center gap-2 rounded-lg bg-[#d5a34d] px-4 text-xs font-semibold text-[#1d1d1b] hover:bg-[#e3b766]" data-testid="button-resume-capture"><Play size={14} /> Resume capture</button>
                  )}
                  <button onClick={stopCapture} className="flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3.5 text-xs text-[#c2c1bc] transition-colors hover:border-[#d67a6e]/40 hover:text-[#e89a8f]" data-testid="button-stop-capture"><Square size={12} /> Stop</button>
                </>
              )}
              <span className="ml-1 flex items-center gap-1.5 font-mono-ui text-[10px] text-[#777d82]" data-testid="status-ocr"><ScanText size={13} /> {captureState === 'capturing' ? `${ocrStatus}${ocrProgress > 0 && ocrProgress < 100 ? ` ${ocrProgress}%` : ''}` : 'Local Japanese text detection'}</span>
            </div>
            {captureError && <p className="relative mt-3 flex items-center gap-2 text-xs text-[#e69b8f]" role="alert" data-testid="text-capture-error"><CircleHelp size={13} />{captureError}</p>}
            <div className={captureState === 'capturing' || captureState === 'paused' ? 'relative mt-5 space-y-2' : 'fixed -left-[10000px] top-0 h-px w-px overflow-hidden opacity-0'}>
              <div
                className={`relative w-full overflow-hidden rounded-xl border border-white/10 bg-black ${selectingRegion ? 'cursor-crosshair touch-none' : ''}`}
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
                    className="pointer-events-none absolute border-2 border-[#d5a34d] shadow-[0_0_0_9999px_rgba(0,0,0,.3)]"
                    style={{ left: `${ocrRegion.x * 100}%`, top: `${ocrRegion.y * 100}%`, width: `${ocrRegion.width * 100}%`, height: `${ocrRegion.height * 100}%` }}
                  />
                )}
                {selectingRegion && draftRegion && (
                  <div
                    className="pointer-events-none absolute border-2 border-[#f0c26f] shadow-[0_0_0_9999px_rgba(0,0,0,.42)]"
                    style={{ left: `${draftRegion.x * 100}%`, top: `${draftRegion.y * 100}%`, width: `${draftRegion.width * 100}%`, height: `${draftRegion.height * 100}%` }}
                  />
                )}
                {selectingRegion && !draftRegion && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 text-xs font-medium text-white">Drag around the Japanese dialogue</div>}
              </div>
              {(captureState === 'capturing' || captureState === 'paused') && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                  <span className="text-[#858b8d]">{ocrRegion ? 'OCR reads only the highlighted dialogue area.' : 'OCR reads the full shared screen.'}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        selectionStartRef.current = null;
                        setDraftRegion(null);
                        setCaptureError('');
                        setSelectingRegion((value) => !value);
                      }}
                      className="text-[#d5a34d] transition-colors hover:text-[#f1d39b]"
                      data-testid="button-select-dialogue-region"
                    >
                      {selectingRegion ? 'Cancel area selection' : ocrRegion ? 'Redraw dialogue area' : 'Select dialogue area'}
                    </button>
                    {ocrRegion && <button type="button" onClick={() => { setOcrRegion(null); setSelectingRegion(false); }} className="text-[#9b9fa0] hover:text-[#dedbd3]" data-testid="button-reset-dialogue-region">Full screen</button>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-white/[.09] bg-[#1a1d24] p-5 sm:p-6">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[#78c2a4]"><Gamepad2 size={13} /> At a glance</div>
              <div className="flex items-end justify-between gap-3">
                <div><div className="font-mono-ui text-3xl tracking-[-.06em]" data-testid="text-line-count">{lines.length.toString().padStart(2, '0')}</div><p className="mt-1 text-xs text-[#96999d]">translated lines this session</p></div>
                <div className="mb-1 flex items-center gap-2 text-right text-[11px] text-[#96999d]"><span className="h-1.5 w-1.5 rounded-full bg-[#78c2a4]" />Japanese <ArrowDown size={12} className="text-[#6c7277]" /> English</div>
              </div>
            </div>
            <div className="mt-5 border-t border-white/[.07] pt-3 text-[11px] leading-relaxed text-[#777d82]">
              <div className="flex items-center justify-between"><span>Translation engine</span><span className="font-mono-ui text-[#b3b2ad]">OpenAI · GPT-5 mini</span></div>
            </div>
          </div>
        </section>

        <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[.09] bg-[#191c22]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d5a34d]/10 text-[#d5a34d]"><Captions size={16} /></div>
                <div><h2 className="text-sm font-semibold">Dialogue stream</h2><p className="mt-0.5 text-[10px] text-[#7e8388]">Most recent first <span className="mx-1 text-[#545b60]">/</span> {lines.length} {lines.length === 1 ? 'line' : 'lines'}</p></div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setAutoScroll((value) => !value)} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[10px] transition-colors ${autoScroll ? 'bg-white/[.06] text-[#d6d5cf]' : 'text-[#81868a] hover:bg-white/[.04]'}`} data-testid="button-toggle-follow"><ArrowDown size={12} /> Follow</button>
                <button onClick={() => setLines([])} disabled={!lines.length} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[10px] text-[#81868a] transition-colors hover:bg-[#d67a6e]/10 hover:text-[#e59b90] disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-clear-transcript"><Trash2 size={12} /> Clear</button>
              </div>
            </div>
            <div ref={transcriptRef} className="max-h-[420px] min-h-[258px] overflow-y-auto scroll-smooth">
              {translate.isPending && (
                <div className="border-b border-white/[.06] px-5 py-5" data-testid="status-translating">
                  <div className="mb-3 flex items-center gap-2 font-mono-ui text-[9px] uppercase tracking-[.16em] text-[#d5a34d]"><LoaderCircle size={12} className="animate-spin" />Translating</div>
                  <div className="h-3 w-2/3 animate-pulse rounded bg-white/[.07]" /><div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-white/[.05]" />
                </div>
              )}
              {(translationError || translate.isError) && <div className="mx-5 my-4 rounded-lg border border-[#d67a6e]/20 bg-[#d67a6e]/[.07] px-3 py-2.5 text-xs text-[#e4a097]" role="alert" data-testid="status-translation-error">{translationError || 'Translation failed. Submit the line again to retry.'}</div>}
              {lines.length ? lines.map((line, index) => (
                <article key={line.timestamp} className={`group border-b border-white/[.055] px-5 py-5 transition-colors hover:bg-white/[.015] ${index === 0 ? 'rise-in' : ''}`} data-testid={`card-translation-${line.timestamp}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2 font-mono-ui text-[9px] uppercase tracking-[.13em] text-[#737a80]"><span className="h-1 w-1 rounded-full bg-[#78c2a4]" />{new Date(line.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <button onClick={() => copyTranslation(line)} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-[#7e8589] opacity-0 transition-all hover:bg-white/[.06] hover:text-[#e4e0d6] group-hover:opacity-100 focus:opacity-100" data-testid={`button-copy-translation-${line.timestamp}`} aria-label="Copy translation">{copiedId === line.timestamp ? <Check size={12} /> : <Copy size={12} />}{copiedId === line.timestamp ? 'Copied' : 'Copy'}</button>
                  </div>
                  <p className="font-jp text-[15px] leading-[1.8] text-[#d7d4cc]" lang="ja" data-testid={`text-source-${line.timestamp}`}>{line.sourceText}</p>
                  <div className="mt-2 flex items-start gap-2.5">
                    <span className="mt-[3px] h-4 w-[2px] shrink-0 rounded bg-[#d5a34d]" />
                    <p className="text-sm leading-relaxed text-[#f0d49f]" data-testid={`text-translation-${line.timestamp}`}>{line.translatedText}</p>
                  </div>
                </article>
              )) : (
                <div className="flex min-h-[258px] flex-col items-center justify-center px-6 py-10 text-center" data-testid="empty-transcript">
                  <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d5a34d]/20 bg-[#d5a34d]/[.06] text-[#d5a34d]"><Captions size={23} strokeWidth={1.4} /><span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#78c2a4]" /></div>
                  <h3 className="text-sm font-medium text-[#dfddd5]">Your dialogue appears here</h3>
                  <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[#7e8489]">Select a game capture to detect and translate Japanese dialogue automatically, or enter a line below.</p>
                </div>
              )}
            </div>
            <Form {...manualForm}>
            <form onSubmit={submitText} className="border-t border-white/[.07] bg-[#171a20] p-4 sm:px-5">
              <label htmlFor="dialogue-input" className="mb-2 flex items-center justify-between text-[10px] font-medium uppercase tracking-[.14em] text-[#81868a]"><span>Translate a line</span><span className="font-mono-ui normal-case tracking-normal">Japanese → English</span></label>
              <div className="flex gap-2">
                <input id="dialogue-input" {...manualForm.register('text', { maxLength: 2000 })} value={draft} maxLength={2000} placeholder="Paste or type Japanese dialogue…" className="h-11 min-w-0 flex-1 rounded-lg border border-white/[.1] bg-[#20232a] px-3.5 font-jp text-sm text-[#e9e7df] outline-none placeholder:font-sans placeholder:text-[#6e747a] focus:border-[#d5a34d]/50 focus:ring-2 focus:ring-[#d5a34d]/10" data-testid="input-dialogue" />
                <button type="submit" disabled={!draft.trim() || translate.isPending} className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-[#d5a34d] px-4 text-xs font-semibold text-[#201e19] transition-all hover:bg-[#e3b766] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-translate"><Languages size={14} /> Translate</button>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-[#656c72]"><span>Manual translation is available alongside automatic capture.</span><span className="font-mono-ui">{draft.length}/2000</span></div>
            </form>
            </Form>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-white/[.09] bg-[#191c22] p-5">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.19em] text-[#aab0b2]"><Settings2 size={14} /> Session setup</div>
              <div className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-white/[.055] pb-3.5">
                  <div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[.04] text-[#9a9ea0]"><Languages size={14} /></span><div><p className="text-xs text-[#dedbd3]">Language pair</p><p className="mt-0.5 text-[10px] text-[#7f8588]">Source and target</p></div></div>
                  <span className="flex items-center gap-1 text-[10px] text-[#b4b2aa]">JA <ChevronDown size={12} /></span>
                </div>
                <div className="flex items-center justify-between border-b border-white/[.055] pb-3.5">
                  <div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[.04] text-[#9a9ea0]"><Radio size={14} /></span><div><p className="text-xs text-[#dedbd3]">Capture mode</p><p className="mt-0.5 text-[10px] text-[#7f8588]">Share a game window</p></div></div>
                  <span className="rounded-md bg-white/[.045] px-2 py-1 text-[9px] text-[#acada8]">Window</span>
                </div>
                <div className="flex items-center justify-between border-b border-white/[.055] pb-3.5">
                  <div><p className="text-xs text-[#dedbd3]">Japanese text layout</p><p className="mt-0.5 text-[10px] text-[#7f8588]">Choose how dialogue is arranged</p></div>
                  <select
                    value={ocrOrientation}
                    onChange={(event) => setOcrOrientation(event.target.value as 'horizontal' | 'vertical')}
                    disabled={captureState !== 'idle' && captureState !== 'error'}
                    className="rounded-md border border-white/[.1] bg-[#20232a] px-2 py-1.5 text-[10px] text-[#c7c4bc] outline-none focus:border-[#d5a34d]/50 disabled:opacity-50"
                    data-testid="select-ocr-orientation"
                  >
                    <option value="horizontal">Horizontal</option>
                    <option value="vertical">Vertical</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[.04] text-[#9a9ea0]"><Volume2 size={14} /></span><div><p className="text-xs text-[#dedbd3]">Overlay preview</p><p className="mt-0.5 text-[10px] text-[#7f8588]">Transparent companion view</p></div></div>
                  <button onClick={() => void openOverlay()} className="flex h-7 items-center gap-1 rounded-md border border-white/[.1] px-2 text-[10px] text-[#c1beb4] hover:border-[#d5a34d]/40 hover:text-[#f1d39b]" data-testid="button-preview-overlay">{isDesktop ? 'Open' : 'Preview'} <ArrowUpRight size={11} /></button>
                </div>
              </div>
              <Form {...apiForm}>
              <form onSubmit={saveApiBaseUrl} className="mt-4 border-t border-white/[.07] pt-4">
                <label htmlFor="translation-api-url" className="mb-2 block text-[10px] font-medium uppercase tracking-[.14em] text-[#81868a]">Translation service URL</label>
                <div className="flex gap-2">
                  <input
                    id="translation-api-url"
                    type="url"
                    {...apiForm.register('url', { onChange: () => setApiSaved(false) })}
                    value={apiBaseUrl}
                    placeholder={isDesktop ? 'https://your-published-app.replit.app' : 'Optional for this preview'}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-white/[.1] bg-[#20232a] px-2.5 text-[10px] text-[#e9e7df] outline-none placeholder:text-[#6e747a] focus:border-[#d5a34d]/50"
                    data-testid="input-translation-api-url"
                  />
                  <button type="submit" className="h-9 rounded-lg border border-white/[.12] px-2.5 text-[10px] text-[#c1beb4] transition-colors hover:border-[#d5a34d]/40 hover:text-[#f1d39b]" data-testid="button-save-api-url">Save</button>
                </div>
                {serviceTokenSet && <button type="button" onClick={() => { serviceTokenRef.current = ''; setServiceTokenSet(false); setApiSaved(false); }} className="mt-2 text-[10px] text-[#9b9fa0] hover:text-[#e89a8f]" data-testid="button-clear-service-token">Clear in-memory token</button>}
                <label htmlFor="translation-api-token" className="mb-2 mt-3 block text-[10px] font-medium uppercase tracking-[.14em] text-[#81868a]">Service access token</label>
                <input
                  id="translation-api-token"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={256}
                  {...apiForm.register('token', { onChange: () => setApiSaved(false) })}
                  value={tokenDraft}
                  placeholder="Enter the matching KOTOBA_API_TOKEN"
                  className="h-9 w-full rounded-lg border border-white/[.1] bg-[#20232a] px-2.5 text-[10px] text-[#e9e7df] outline-none placeholder:text-[#6e747a] focus:border-[#d5a34d]/50"
                  data-testid="input-translation-api-token"
                />
                <p className="mt-2 text-[10px] leading-relaxed text-[#737a7e]">Use the API server’s KOTOBA_API_TOKEN, never your OpenAI key. It stays in this window’s memory. {serviceTokenSet && <span className="text-[#78c2a4]" data-testid="status-token-set">Token set for this session.</span>}</p>
                <p className="mt-2 text-[10px] leading-relaxed text-[#737a7e]">{isDesktop ? 'Use your published Kotoba API domain; the OpenAI key stays on the server.' : 'Leave the URL blank to use this preview’s translation service.'} {apiSaved && <span className="text-[#78c2a4]" data-testid="status-api-saved">Settings saved</span>}</p>
              </form>
              </Form>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[#78c2a4]/15 bg-[#1b2424] p-5">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.17em] text-[#79c7a7]"><ShieldCheck size={14} /> Built for your session</div>
              <p className="text-[12px] leading-[1.7] text-[#a4b1aa]">Captured frames stay on your device for OCR. Only recognized Japanese text is sent to your configured translation service.</p>
              <div className="mt-4 flex items-center gap-2 border-t border-white/[.06] pt-3 font-mono-ui text-[9px] tracking-[.05em] text-[#76877e]"><span className="h-1.5 w-1.5 rounded-full bg-[#79c7a7]" /> No game files modified</div>
            </div>
            <div className="flex items-start gap-2.5 px-1 text-[10px] leading-relaxed text-[#737a7e]"><CircleHelp size={13} className="mt-0.5 shrink-0 text-[#858b8d]" /><p>For the overlay to appear over a game, use the Windows desktop build. Borderless-window mode is recommended for fullscreen games.</p></div>
          </aside>
        </section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.07] pt-4 text-[10px] text-[#62696e]">
          <span className="font-mono-ui tracking-[.08em]">KOTOBA OVERLAY <span className="mx-1 text-[#42494e]">/</span> PLAY ON</span>
          <span className="flex items-center gap-1.5">Made for stories worth understanding <span className="text-[#d5a34d]">·</span> <button onClick={() => void openOverlay()} className="inline-flex items-center gap-1 text-[#8b908f] hover:text-[#d5a34d]" data-testid="button-overlay-mode">Overlay window <ArrowUpRight size={10} /></button></span>
        </footer>
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </main>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
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
