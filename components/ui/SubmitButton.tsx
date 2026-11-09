'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from './Button';

/** Submit button that shows the loading state while its parent <form action> is pending. */
export function SubmitButton({ loading, ...props }: Omit<ButtonProps, 'type'>) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" loading={loading || pending} />;
}
