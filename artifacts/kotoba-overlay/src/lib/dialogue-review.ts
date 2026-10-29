export const DIALOGUE_SETTLE_MS = 3000;

export type TranslationReview = {
  id: string;
  sourceText: string;
  translatedText: string | null;
  timestamp: number;
  status: 'translating' | 'pending' | 'accepted' | 'error';
  error?: string;
};

/** OCR observations, not a timer alone, must confirm that a page has settled. */
export class DialogueGate {
  private candidate: string | null = null;
  private since = 0;
  private consumed = '';

  reset() {
    this.candidate = null;
    this.since = 0;
    this.consumed = '';
  }

  interrupt() {
    this.candidate = null;
    this.since = 0;
  }

  markAttempted(text: string) {
    this.consumed = text.normalize('NFKC').replace(/\s+/g, '');
  }

  observe(text: string, now: number) {
    const key = text.normalize('NFKC').replace(/\s+/g, '');
    if (key !== this.candidate) {
      this.candidate = key;
      this.since = now;
    }
    if (!key && now - this.since >= DIALOGUE_SETTLE_MS) this.consumed = '';
  }

  claim(now: number) {
    if (!this.candidate || this.candidate === this.consumed ||
      now - this.since < DIALOGUE_SETTLE_MS) return false;
    // Claim before awaiting a provider; failed attempts must not auto-repeat.
    this.consumed = this.candidate;
    return true;
  }
}

export function approveReview(
  review: TranslationReview | null, id: string,
  lines: { sourceText: string; translatedText: string; timestamp: number }[],
  limit: number,
) {
  if (!review || review.id !== id || review.status !== 'pending' || !review.translatedText) return null;
  if (lines.length >= limit) throw new Error('Journal full (500 lines). Export a backup, then clear the journal before approving this translation.');
  return {
    review: { ...review, status: 'accepted' as const, error: undefined },
    lines: [{
      sourceText: review.sourceText, translatedText: review.translatedText,
      timestamp: Math.max(review.timestamp, (lines[0]?.timestamp ?? 0) + 1),
    }, ...lines],
  };
}
