import clsx from 'clsx';

interface Props {
  score: number | null;
  size?: 'sm' | 'lg';
}

export default function HealthScore({ score, size = 'sm' }: Props) {
  if (score === null || score < 0) {
    return (
      <span className="text-gray-500 text-sm">N/A</span>
    );
  }

  const color =
    score >= 80 ? 'text-emerald-400' :
    score >= 60 ? 'text-yellow-400' :
    score >= 40 ? 'text-orange-400' : 'text-red-400';

  return (
    <span
      className={clsx(
        'font-bold',
        color,
        size === 'lg' ? 'text-4xl' : 'text-lg'
      )}
    >
      {score}
    </span>
  );
}
