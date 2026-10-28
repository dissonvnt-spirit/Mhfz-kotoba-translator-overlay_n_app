// Only these authored messages cross the worker/UI boundary. Never expose raw
// fetch errors (which may contain signed URLs), dialogue, or device paths.
export const OFFLINE_ERRORS = {
  'LOCAL-STORAGE': 'The model could not be saved on this device. Check free disk space and allow app storage, then retry. Saved downloads are reused.',
  'LOCAL-DOWNLOAD': 'A model file could not be downloaded. Check your internet connection and whether your firewall permits huggingface.co and its download hosts, then retry.',
  'LOCAL-RUNTIME': 'The bundled translation engine could not start. Close other memory-heavy apps and retry. If it repeats, reinstall the latest Windows build and check WebView2.',
  'LOCAL-MISSING': 'The local model is not ready. Connect to the internet and choose Prepare local model, then retry.',
  'LOCAL-INFERENCE': 'The local model could not translate the test sentence. Close other memory-heavy apps and retry preparation.',
  'LOCAL-WORKER': 'The local translation worker could not start. Restart the app and retry. If it repeats, reinstall the latest Windows build and check WebView2.',
  'LOCAL-TIMEOUT': 'Local translation stopped responding. Check your connection, free disk space and memory, then retry. Saved downloads are reused.',
} as const;

export type OfflineErrorCode = keyof typeof OFFLINE_ERRORS;
export type OfflineStage = 'storage' | 'download' | 'runtime' | 'self-test' | 'translation';
export const OFFLINE_STAGES: OfflineStage[] = ['storage', 'download', 'runtime', 'self-test', 'translation'];
const FILES = new Set([
  'config.json', 'tokenizer_config.json', 'tokenizer.json', 'generation_config.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
]);

export function safeModelFile(value: unknown): string | undefined {
  return typeof value === 'string' && FILES.has(value) ? value : undefined;
}

export function offlineError(code: OfflineErrorCode, stage?: OfflineStage, file?: string): string {
  const detail = [stage && OFFLINE_STAGES.includes(stage) ? stage : undefined, safeModelFile(file)].filter(Boolean).join('; ');
  return `[${code}${detail ? `; ${detail}` : ''}] ${OFFLINE_ERRORS[code]} No dialogue was sent to the cloud.`;
}

export class OfflineSetupError extends Error {}

export function offlineFailureMessage(error: unknown): string {
  return error instanceof OfflineSetupError ? error.message : offlineError('LOCAL-WORKER');
}
