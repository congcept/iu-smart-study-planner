import type { ReactNode } from 'react';

type Metric = { label: ReactNode; value: ReactNode; key: string; valueClassName?: string };

export function MetricList({
  items,
  layout = 'stacked',
}: {
  items: readonly Metric[];
  layout?: 'stacked' | 'grid';
}) {
  if (layout === 'grid')
    return (
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        {items.map(({ key, label, value }) => (
          <div
            key={key}
            className="flex items-baseline justify-between gap-4 border-b border-gray-200 pb-2"
          >
            <dt className="text-gray-700">{label}</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
    );
  return (
    <dl className="space-y-2 text-sm text-gray-700">
      {items.map(({ key, label, value, valueClassName }) => (
        <div key={key}>
          <dt className="font-medium">{label}</dt>
          <dd className={valueClassName}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
