import { AlertCircle } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center p-4">
      <div className="hunt-frame w-full max-w-md p-6">
        <div className="mb-3 flex items-center gap-2">
          <AlertCircle className="h-7 w-7 text-[hsl(var(--ember-hi))]" />
          <h1 className="font-display text-2xl font-bold text-[hsl(var(--parchment))]">Off the map</h1>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">This page does not exist in MHFZ-Z Translator Overlay.</p>
        <Link href="/" className="btn-bronze mt-5 inline-flex" data-testid="link-home">Return to camp</Link>
      </div>
    </div>
  );
}
