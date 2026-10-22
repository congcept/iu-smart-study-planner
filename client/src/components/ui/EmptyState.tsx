import type { HTMLAttributes, ReactNode } from 'react';

type EmptyStateProps = HTMLAttributes<HTMLParagraphElement> & { children: ReactNode };

export function EmptyState({
  children,
  className = 'text-sm text-gray-700',
  ...props
}: EmptyStateProps) {
  return (
    <p className={className} {...props}>
      {children}
    </p>
  );
}
