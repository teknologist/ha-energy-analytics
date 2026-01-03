import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

/**
 * KPI stat card component
 * @param {Object} props
 * @param {string} props.title - Card title
 * @param {string|number} props.value - Main value to display
 * @param {string} [props.unit] - Unit of measurement
 * @param {React.ReactNode} props.icon - Icon component
 * @param {boolean} [props.isLoading] - Loading state
 * @param {boolean} [props.isLive] - Show live indicator
 * @param {string} [props.subtitle] - Additional info
 */
export function KPICard({
  title,
  value,
  unit,
  icon,
  isLoading,
  isLive,
  subtitle,
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="flex items-center gap-2">
          {isLive && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              Live
            </Badge>
          )}
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <>
            <div className="text-2xl font-bold">
              {value}
              {unit && (
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {unit}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
