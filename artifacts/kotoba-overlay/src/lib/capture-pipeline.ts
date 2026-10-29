export type CaptureRegion = { x: number; y: number; width: number; height: number };
export type CapturePhase = 'selection' | 'frames' | 'ocr-start' | 'ocr-read';

export class CapturePipelineError extends Error {
  readonly phase: CapturePhase;
  constructor(phase: CapturePhase, message: string) {
    super(message);
    this.phase = phase;
    this.name = 'CapturePipelineError';
  }
}

export function withCaptureDeadline<T>(
  promise: Promise<T>, milliseconds: number, error: CapturePipelineError,
  disposeLateValue?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(error); }, milliseconds);
    promise.then(value => {
      clearTimeout(timer);
      if (expired) disposeLateValue?.(value);
      else resolve(value);
    }, failure => { clearTimeout(timer); if (!expired) reject(failure); });
  });
}

/** Wait for actual frame dimensions/data, not just a resolved play() promise. */
export function waitForCaptureFrame(video: HTMLVideoElement, milliseconds = 12_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const events = ['loadeddata', 'loadedmetadata', 'canplay', 'resize'];
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      for (const event of events) video.removeEventListener(event, check);
      video.removeEventListener('error', fail);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const fail = () => finish(new CapturePipelineError('frames',
      'The selected source could not produce video. Restore the game window and try screen capture in windowed or borderless mode.'));
    const timer = setTimeout(() => finish(new CapturePipelineError('frames',
      'No usable video frame arrived within 12 seconds. Restore the game window, try capturing the whole display, and check Microsoft Edge WebView2.')), milliseconds);
    const poll = setInterval(check, 200);
    for (const event of events) video.addEventListener(event, check);
    video.addEventListener('error', fail);
    try {
      void Promise.resolve(video.play()).then(check, () => fail());
    } catch { fail(); }
    check();
  });
}

/** Clamp both crop edges; preserve full-HD glyph detail instead of shrinking to 1200px. */
export function captureGeometry(width: number, height: number, region: CaptureRegion | null) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new CapturePipelineError('frames', 'The capture has no usable frame dimensions.');
  }
  if (region && (!Object.values(region).every(Number.isFinite) || region.width <= 0 || region.height <= 0)) {
    throw new CapturePipelineError('ocr-read', 'The dialogue crop is empty or invalid. Redraw the dialogue area.');
  }
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const left = region ? Math.floor(clamp(region.x) * width) : 0;
  const top = region ? Math.floor(clamp(region.y) * height) : 0;
  const right = region ? Math.ceil(clamp(region.x + region.width) * width) : width;
  const bottom = region ? Math.ceil(clamp(region.y + region.height) * height) : height;
  const cropWidth = right - left, cropHeight = bottom - top;
  if (cropWidth < 1 || cropHeight < 1) {
    throw new CapturePipelineError('ocr-read', 'The dialogue crop is outside the video frame. Redraw the dialogue area.');
  }
  const scale = Math.min(region ? 2 : 1, 2560 / cropWidth, 2560 / cropHeight);
  return {
    left, top, cropWidth, cropHeight,
    width: Math.max(1, Math.round(cropWidth * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
  };
}

export function readableJapanese(text: string) {
  const normalized = text.replace(/[ \t]+/g, ' ').trim().slice(0, 1800)
    .replace(/([\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff]) +(?=[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff])/g, '$1');
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(normalized) ? normalized : '';
}

export function captureFailureMessage(error: unknown, phase: CapturePhase) {
  if (error instanceof CapturePipelineError) return error.message;
  if (phase === 'selection') {
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError') {
      return 'Screen sharing was denied or cancelled. Choose a source again. If no picker appears, update Microsoft Edge WebView2 and check Windows screen-capture permissions.';
    }
    return 'Screen capture could not open. Restore the game and try a whole-display source in windowed or borderless mode. This is not a cloud translation error.';
  }
  if (phase === 'ocr-start') {
    return 'Local Japanese OCR could not load. Stop and retry; if this persists, reinstall the latest app to restore its bundled OCR worker, language data and WebAssembly files. Cloud mode still requires local OCR.';
  }
  if (phase === 'ocr-read') {
    return 'Japanese OCR could not read this frame. Redraw the dialogue area and restart capture. No text from this failed frame was sent for translation.';
  }
  return 'Video frames are unavailable. Restore the game and try whole-display capture in windowed or borderless mode.';
}
