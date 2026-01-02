import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * StatCard - Statistics display card with icon, subtitle, and color variants
 *
 * @param {Object} props
 * @param {string} props.title - Card title
 * @param {string|number} props.value - Main value to display
 * @param {string} [props.subtitle] - Optional subtitle or description
 * @param {React.ReactNode} [props.icon] - Optional icon component
 * @param {'default'|'primary'|'success'|'warning'|'danger'} [props.color='default'] - Color variant
 * @param {string} [props.className] - Additional CSS classes
 *
 * @example
 * <StatCard
 *   title="Total Consumption"
 *   value="245.3 kWh"
 *   subtitle="Last 24 hours"
 *   icon={<Zap />}
 *   color="primary"
 * />
 */
export function StatCard({
  title,
  value,
  subtitle,
  icon,
  color = 'default',
  className,
}) {
  const colorConfig = {
    default: {
      card: '',
      icon: 'text-muted-foreground',
      title: 'text-muted-foreground',
      value: 'text-foreground',
      subtitle: 'text-muted-foreground',
    },
    primary: {
      card: 'border-primary/20',
      icon: 'text-primary',
      title: 'text-muted-foreground',
      value: 'text-primary',
      subtitle: 'text-muted-foreground',
    },
    success: {
      card: 'border-green-500/20',
      icon: 'text-green-500',
      title: 'text-muted-foreground',
      value: 'text-green-500',
      subtitle: 'text-muted-foreground',
    },
    warning: {
      card: 'border-amber-500/20',
      icon: 'text-amber-500',
      title: 'text-muted-foreground',
      value: 'text-amber-500',
      subtitle: 'text-muted-foreground',
    },
    danger: {
      card: 'border-red-500/20',
      icon: 'text-red-500',
      title: 'text-muted-foreground',
      value: 'text-red-500',
      subtitle: 'text-muted-foreground',
    },
  };

  const config = colorConfig[color] || colorConfig.default;

  return (
    <Card className={cn(config.card, className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className={cn('text-sm font-medium', config.title)}>
          {title}
        </CardTitle>
        {icon && <span className={cn('text-xl', config.icon)}>{icon}</span>}
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          <div className={cn('text-2xl font-bold', config.value)}>{value}</div>
          {subtitle && (
            <p className={cn('text-xs', config.subtitle)}>{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
