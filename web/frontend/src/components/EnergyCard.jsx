import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EnergyCard - A card component for displaying energy metrics with trend indicators
 *
 * @param {Object} props
 * @param {string} props.title - Card title
 * @param {string|number} props.value - Main value to display
 * @param {string} props.unit - Unit of measurement (e.g., "kWh", "W")
 * @param {'up'|'down'|'neutral'} [props.trend='neutral'] - Trend direction
 * @param {number} [props.trendValue] - Optional trend percentage or value
 * @param {React.ReactNode} [props.icon] - Optional icon component
 * @param {string} [props.className] - Additional CSS classes
 *
 * @example
 * <EnergyCard
 *   title="Total Consumption"
 *   value="245.3"
 *   unit="kWh"
 *   trend="up"
 *   trendValue={12.5}
 *   icon={<Zap />}
 * />
 */
export function EnergyCard({
  title,
  value,
  unit,
  trend = 'neutral',
  trendValue,
  icon,
  className,
}) {
  const trendConfig = {
    up: {
      icon: TrendingUp,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      label: 'Increased',
    },
    down: {
      icon: TrendingDown,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      label: 'Decreased',
    },
    neutral: {
      icon: Minus,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
      label: 'Stable',
    },
  };

  const config = trendConfig[trend] || trendConfig.neutral;
  const TrendIcon = config.icon;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon && <span className="text-xl text-muted-foreground">{icon}</span>}
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="text-2xl font-bold">
            {value}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              {unit}
            </span>
          </div>
          {trend !== 'neutral' && (
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={cn('gap-1', config.bgColor, config.color)}
              >
                <TrendIcon className="h-3 w-3" />
                {trendValue !== undefined && (
                  <span className="text-xs font-medium">
                    {typeof trendValue === 'number'
                      ? `${trendValue.toFixed(1)}%`
                      : trendValue}
                  </span>
                )}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {config.label}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
