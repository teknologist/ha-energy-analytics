import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';

/**
 * StatusIndicator - Connection/status indicator component
 *
 * @param {Object} props
 * @param {'connected'|'disconnected'|'connecting'|'error'} props.status - Current status
 * @param {string} [props.label] - Optional label text
 * @param {'default'|'compact'} [props.variant='default'] - Display variant
 * @param {string} [props.className] - Additional CSS classes
 *
 * @example
 * <StatusIndicator status="connected" label="Home Assistant" />
 * <StatusIndicator status="connecting" variant="compact" />
 */
export function StatusIndicator({
  status,
  label,
  variant = 'default',
  className,
}) {
  const statusConfig = {
    connected: {
      icon: CheckCircle2,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/20',
      label: 'Connected',
      pulse: false,
    },
    disconnected: {
      icon: XCircle,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/20',
      label: 'Disconnected',
      pulse: false,
    },
    connecting: {
      icon: Loader2,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/20',
      label: 'Connecting',
      pulse: true,
    },
    error: {
      icon: AlertCircle,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
      label: 'Error',
      pulse: true,
    },
  };

  const config = statusConfig[status] || statusConfig.disconnected;
  const Icon = config.icon;
  const displayLabel = label || config.label;

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <Icon
          className={cn(
            'h-4 w-4',
            config.color,
            config.pulse && 'animate-pulse'
          )}
        />
        {displayLabel && (
          <span className="text-xs text-muted-foreground">{displayLabel}</span>
        )}
      </div>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 px-2.5 py-1',
        config.bgColor,
        config.borderColor,
        config.color,
        className
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', config.pulse && 'animate-spin')} />
      <span className="text-xs font-medium">{displayLabel}</span>
    </Badge>
  );
}
