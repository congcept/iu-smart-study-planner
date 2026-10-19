import type { HTMLAttributes, ReactNode } from 'react';

type ErrorBannerProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: 'p' | 'div';
};

export function ErrorBanner({
  children,
  as: Element = 'p',
  className = 'text-sm text-red-700',
  ...props
}: ErrorBannerProps) {
  return (
    <Element role="alert" className={className} {...props}>
      {children}
    </Element>
  );
}
