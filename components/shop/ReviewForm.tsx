'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { submitReviewAction } from '@/app/[locale]/(shop)/actions';

/**
 * Review form for a verified buyer (the server decides eligibility again on submit). The review is
 * stored pending moderation: the confirmation says so, and nothing is shown as published.
 */
export function ReviewForm({ productId }: { productId: string }) {
  const t = useTranslations('product.reviews.write');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-card border border-success/40 bg-success/10 p-4 text-sm font-medium" data-testid="review-thanks">
        <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
        {t('thanks')}
      </p>
    );
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = String(data.get('text') ?? '').trim();
    const title = String(data.get('title') ?? '').trim();
    if (rating < 1 || text.length < 10) {
      setError(t('errors.invalid'));
      return;
    }
    setError(null);
    start(async () => {
      const res = await submitReviewAction(productId, { rating, title: title || undefined, text });
      if (res.ok) setSent(true);
      else setError(t(`errors.${res.error}`));
    });
  };

  const shown = hover || rating;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5" aria-labelledby="review-form-title" data-testid="review-form">
      <div>
        <h3 id="review-form-title" className="text-lg font-bold">
          {t('title')}
        </h3>
        <p className="mt-1 text-sm text-muted">{t('intro')}</p>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t('rating')}</legend>
        <div role="radiogroup" aria-label={t('rating')} className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={t('stars', { count: n })}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              data-testid={`review-star-${n}`}
              className="grid size-11 place-items-center rounded-full transition-transform duration-(--dur-btn) hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95"
            >
              <Star size={28} aria-hidden="true" className={cn('transition-colors', n <= shown ? 'fill-amber text-amber' : 'text-border-strong')} />
            </button>
          ))}
        </div>
      </fieldset>

      <Input name="title" label={t('titleLabel')} maxLength={80} autoComplete="off" />
      <Textarea name="text" label={t('textLabel')} hint={t('textHint')} rows={4} maxLength={2000} required />

      {error ? (
        <p role="alert" className="text-sm font-medium text-error" data-testid="review-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="accent" loading={pending} loadingLabel={t('sending')} className="self-start" data-testid="review-submit">
        {t('submit')}
      </Button>
    </form>
  );
}
