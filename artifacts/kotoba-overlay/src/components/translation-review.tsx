import type { TranslationReview as Review } from '@/lib/dialogue-review';

export function TranslationReview({ review, busy = false, onAccept, onRetry }: {
  review: Review; busy?: boolean; onAccept: (id: string) => void; onRetry: (id: string) => void;
}) {
  return (
    <section className="space-y-2 border border-[hsl(var(--bronze)/.4)] bg-black/15 p-3"
      data-testid="translation-review" aria-busy={review.status === 'translating'}>
      <p className="text-xs font-semibold text-[hsl(var(--bronze-hi))]" role="status">
        {review.status === 'translating' ? 'Translating once…' :
          review.status === 'accepted' ? 'Correct — saved to journal' :
            review.status === 'error' ? 'Attempt failed — retry when ready' : 'Is this translation correct?'}
      </p>
      <p className="font-jp whitespace-pre-wrap break-words text-sm" lang="ja" data-testid="review-source">{review.sourceText}</p>
      {review.translatedText && <p className="whitespace-pre-wrap break-words border-l-2 border-[hsl(var(--ember))] pl-3 text-lg"
        data-testid="review-translation">{review.translatedText}</p>}
      {review.error && <p className="text-xs text-[hsl(var(--ember-hi))]" role="alert">{review.error}</p>}
      {(review.status === 'pending' || review.status === 'error') && <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-bronze px-3 py-2 text-xs" onClick={() => onAccept(review.id)}
          disabled={busy || review.status !== 'pending'} data-testid="button-accept-translation">Correct — save</button>
        <button type="button" className="btn-chip" onClick={() => onRetry(review.id)}
          disabled={busy} data-testid="button-retry-translation">Incorrect — retry</button>
      </div>}
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        {review.status === 'accepted' ? 'Waiting for new dialogue to remain stable for 3 seconds.' :
          'Not saved. Automatic translation waits for your approval. Retry reruns the selected engine; offline results may be identical.'}
      </p>
    </section>
  );
}
