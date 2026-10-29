import { OFFLINE_ERRORS, offlineError, OfflineSetupError, safeModelFile, type OfflineErrorCode, type OfflineStage } from './offline-errors';

type Progress = { status: string; file?: string; progress?: number };
type Reply = { id: number; ready?: boolean; translatedText?: string; error?: OfflineErrorCode; stage?: OfflineStage; file?: string; progress?: Progress };

export class OfflineTranslator {
  private worker: Worker | undefined;
  private sequence = 0;
  private pending: { id: number; resolve: (text: string) => void; reject: (error: Error) => void; status: (message: string) => void } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private fail(code: OfflineErrorCode, stage?: OfflineStage, file?: string) {
    clearTimeout(this.timer);
    const job = this.pending;
    this.pending = undefined;
    // ONNX remembers failed initialization. A fresh worker, not just a fresh
    // pipeline promise, is required for a genuine retry.
    this.worker?.terminate();
    this.worker = undefined;
    job?.reject(new OfflineSetupError(offlineError(code, stage, file)));
  }

  private armTimeout() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail('LOCAL-TIMEOUT'), 5 * 60_000);
  }

  private request(text: string | undefined, allowDownload: boolean, status: (message: string) => void): Promise<string> {
    if (this.pending) return Promise.reject(new Error('The local translator is busy.'));
    try {
      this.worker ??= new Worker(new URL('./offline-translation.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return Promise.reject(new OfflineSetupError(offlineError('LOCAL-WORKER')));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, status };
      this.armTimeout();
      this.worker!.onerror = (event) => {
        event.preventDefault();
        this.fail('LOCAL-WORKER');
      };
      this.worker!.onmessageerror = () => this.fail('LOCAL-WORKER');
      this.worker!.onmessage = (event: MessageEvent<Reply>) => {
        const reply = event.data;
        const job = this.pending;
        if (!job || reply.id !== job.id) return;
        if (reply.progress) {
          this.armTimeout();
          const { status: stage, file, progress } = reply.progress;
          if (stage === 'progress') job.status(`Downloading ${safeModelFile(file) ?? 'model'}: ${Math.round(progress ?? 0)}%`);
          else if (stage === 'initiate') job.status(`Preparing ${safeModelFile(file) ?? 'local translation model'}…`);
          else if (stage === 'runtime') job.status('Starting the bundled local translation engine…');
          else if (stage === 'self-test') job.status('Checking Japanese-to-English translation on this device…');
          return;
        }
        if (reply.error) {
          this.fail(Object.hasOwn(OFFLINE_ERRORS, reply.error) ? reply.error : 'LOCAL-WORKER', reply.stage, reply.file);
          return;
        }
        clearTimeout(this.timer);
        this.pending = undefined;
        job.resolve(reply.translatedText ?? '');
      };
      try {
        this.worker!.postMessage({
          id, text, allowDownload,
          assetBase: new URL(`${import.meta.env.BASE_URL}offline-runtime/`, location.origin).href,
        });
      } catch {
        this.fail('LOCAL-WORKER');
      }
    });
  }

  async prepare(status: (message: string) => void) {
    try { await navigator.storage?.persist?.(); } catch { /* Persistence permission is best-effort; IndexedDB writes are checked separately. */ }
    await this.request(undefined, true, status);
  }

  translate(text: string, status: (message: string) => void) {
    return this.request(text, false, status);
  }

  dispose() {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.pending?.reject(new Error('Local translator closed.'));
    this.pending = undefined;
    this.worker = undefined;
  }
}
