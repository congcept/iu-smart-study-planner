import React from 'react';
import type { IntensityMode } from '@/types';

const modes: { value: IntensityMode; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'Casual pace, up to 6 years' },
  { value: 'normal', label: 'Normal', description: 'Standard 4-year trajectory' },
  { value: 'high', label: 'High', description: 'Catch up or graduate early' },
  { value: 'max', label: 'Max', description: 'Push 24 credits per semester' },
];

interface IntensitySliderProps {
  mode: IntensityMode;
  onChange: (mode: IntensityMode) => void;
  disabled?: boolean;
}

export const IntensitySlider: React.FC<IntensitySliderProps> = ({ mode, onChange, disabled = false }) => {
  return (
    <div className={`flex items-center gap-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <label className="text-sm font-medium text-gray-700">
        Intensity:
      </label>
      <div className="flex gap-1 bg-gray-100 rounded-md p-0.5">
        {modes.map(({ value, label, description }) => (
          <button
            key={value}
            onClick={() => onChange(value)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
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
