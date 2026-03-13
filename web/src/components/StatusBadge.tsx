import clsx from 'clsx';

interface Props {
  status: 'online' | 'offline' | 'degraded';
}

export default function StatusBadge({ status }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        {
          'bg-emerald-500/10 text-emerald-400': status === 'online',
          'bg-red-500/10 text-red-400': status === 'offline',
          'bg-yellow-500/10 text-yellow-400': status === 'degraded',
        }
      )}
    >
      <span
        className={clsx('w-2 h-2 rounded-full', {
          'bg-emerald-400 animate-pulse': status === 'online',
          'bg-red-400': status === 'offline',
          'bg-yellow-400 animate-pulse': status === 'degraded',
        })}
      />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
