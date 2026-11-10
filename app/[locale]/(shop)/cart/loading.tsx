import { Skeleton } from '@/components/ui/Skeleton';

/** Shown instantly while the cart is priced on the server. */
export default function CartLoading() {
  return (
    <div className="page-container pb-14 pt-2 lg:pt-10" role="status" aria-busy="true" data-testid="cart-loading">
      <Skeleton className="mx-auto h-7 w-28 lg:mx-0 lg:h-9 lg:w-40" />
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-36 w-full rounded-card" />
          <Skeleton className="h-36 w-full rounded-card" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-52 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
