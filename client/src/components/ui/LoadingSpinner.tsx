import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
  variant?: 'icon' | 'ring';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 24,
  className = '',
  variant = 'icon',
}) => {
  if (variant === 'ring')
    return (
      <div
        aria-hidden="true"
        className={`h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-600 ${className}`.trim()}
      />
    );
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-hidden="true" />;
};
