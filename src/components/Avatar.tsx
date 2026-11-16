import type { PresenceMode } from '../types';
import { getInitials } from '../lib/format';

interface AvatarProps {
  name: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  isOnline?: boolean;
  presenceMode?: PresenceMode;
  showPresence?: boolean;
}

export function Avatar({
  name,
  color = '#2563EB',
  size = 'md',
  isOnline = false,
  presenceMode = 'available',
  showPresence = false,
}: AvatarProps) {
  const sizeClass =
    size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-12 h-12 text-base' : 'w-9 h-9 text-xs';
  const dotSize = size === 'lg' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  const presenceColor = !isOnline
    ? 'bg-slate-300'
    : presenceMode === 'busy'
    ? 'bg-red-500'
    : presenceMode === 'away'
    ? 'bg-amber-500'
    : 'bg-emerald-500';

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`${sizeClass} rounded-lg flex items-center justify-center font-semibold text-white select-none`}
        style={{ backgroundColor: color }}
      >
        {getInitials(name)}
      </div>
      {showPresence && (
        <span
          title={isOnline ? `Online (${presenceMode})` : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 ${dotSize} rounded-full ring-2 ring-white ${presenceColor}`}
        />
      )}
    </div>
  );
}
