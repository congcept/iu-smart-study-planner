import React from 'react';

interface ProgressBarProps {
  progress: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  max = 100,
  size = 'md',
  showLabel = true,
  className = '',
}) => {
  const percentage = Math.min(Math.max((progress / max) * 100, 0), 100);

  const sizeStyles: Record<NonNullable<ProgressBarProps['size']>, string> = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  return (
    <div className={`w-full ${className}`}>
      <div className={`w-full bg-gray-200 rounded-full ${sizeStyles[size]}`}>
        <div
          className="bg-primary-600 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{Math.round(percentage)}%</span>
          <span>
            {progress}/{max}
          </span>
        </div>
      )}
    </div>
  );
};
