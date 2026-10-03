import React from 'react';
import type { IntensityMode } from '@/types';

const modes: { value: IntensityMode; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'Suggest up to 9 credits per semester' },
  { value: 'normal', label: 'Normal', description: 'Suggest up to 15 credits per semester' },
  { value: 'high', label: 'High', description: 'Suggest up to 18 credits per semester' },
  { value: 'max', label: 'Max', description: 'Suggest up to 21 credits per semester' },
];

interface IntensitySliderProps {
  mode: IntensityMode;
  onChange: (mode: IntensityMode) => void;
  disabled?: boolean;
}

export const IntensitySlider: React.FC<IntensitySliderProps> = ({ mode, onChange, disabled = false }) => {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <span id="course-load-label" className="text-sm font-medium text-gray-700">
        Course load:
      </span>
      <div role="group" aria-labelledby="course-load-label" className="flex gap-1 bg-gray-100 rounded-md p-0.5">
        {modes.map(({ value, label, description }) => (
          <button
            key={value}
            onClick={() => onChange(value)}
            disabled={disabled}
            aria-pressed={mode === value}
            className={`min-h-11 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title={description}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};
