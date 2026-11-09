import { notFound } from 'next/navigation';

/** Any unknown localised path renders the localised not-found page (inside the chrome). */
export default function CatchAll() {
  notFound();
}
