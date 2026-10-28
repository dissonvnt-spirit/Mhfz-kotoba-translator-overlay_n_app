type Progress = { status: string; file?: string; progress?: number };
type Reply = { id: number; ready?: boolean; translatedText?: string; error?: string; progress?: Progress };

export class OfflineTranslator {
  private worker: Worker | undefined;
  private sequence = 0;
  private pending: { id: number; resolve: (text: string) => void; reject: (error: Error) => void; status: (message: string) => void } | undefined;

  private request(text: string | undefined, allowDownload: boolean, status: (message: string) => void): Promise<string> {
    if (this.pending) return Promise.reject(new Error('The local translator is busy.'));
    this.worker ??= new Worker(new URL('./offline-translation.worker.ts', import.meta.url), { type: 'module' });
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, status };
      this.worker!.onerror = () => {
        this.pending?.reject(new Error('Local translation engine could not start. Restart the app and try again.'));
        this.pending = undefined;
        this.worker?.terminate();
        this.worker = undefined;
      };
      this.worker!.onmessage = (event: MessageEvent<Reply>) => {
        const reply = event.data;
        const job = this.pending;
        if (!job || reply.id !== job.id) return;
        if (reply.progress) {
          const { status: stage, file, progress } = reply.progress;
          if (stage === 'progress') job.status(`Downloading ${file ?? 'model'}: ${Math.round(progress ?? 0)}%`);
          else if (stage === 'initiate') job.status(`Preparing ${file ?? 'local translation model'}…`);
          return;
        }
        this.pending = undefined;
        if (reply.error) job.reject(new Error(reply.error));
        else job.resolve(reply.translatedText ?? '');
      };
      this.worker!.postMessage({
        id, text, allowDownload,
        assetBase: new URL(`${import.meta.env.BASE_URL}offline-runtime/`, location.origin).href,
      });
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
    this.worker?.terminate();
    this.pending?.reject(new Error('Local translator closed.'));
    this.pending = undefined;
    this.worker = undefined;
  }
}
