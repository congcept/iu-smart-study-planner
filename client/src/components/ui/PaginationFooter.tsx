import { Button } from './Button';

type PaginationFooterProps = {
  next?: { label: string; onClick: () => void; disabled?: boolean };
  end?: string;
};

export function PaginationFooter({ next, end }: PaginationFooterProps) {
  return (
    <>
      {next && (
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={next.disabled}
          onClick={next.onClick}
        >
          {next.label}
        </Button>
      )}
      {end && <p className="text-sm text-gray-600">{end}</p>}
    </>
  );
}
