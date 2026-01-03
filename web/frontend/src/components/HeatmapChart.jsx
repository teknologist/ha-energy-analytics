import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Get color intensity based on consumption value
 * @param {number} value - Consumption value
 * @param {number} min - Min consumption
 * @param {number} max - Max consumption
 * @returns {string} Tailwind color class
 */
function getColorClass(value, min, max) {
  if (max === min) return 'bg-violet-500';

  const normalized = (value - min) / (max - min);

  if (normalized < 0.2) return 'bg-violet-200';
  if (normalized < 0.4) return 'bg-violet-300';
  if (normalized < 0.6) return 'bg-violet-400';
  if (normalized < 0.8) return 'bg-violet-500';
  return 'bg-violet-600';
}

/**
 * Heatmap chart for hour × day consumption patterns
 * @param {Object} props
 * @param {Array} props.data - Heatmap data array
 * @param {number} props.min - Min consumption value
 * @param {number} props.max - Max consumption value
 * @param {boolean} [props.isLoading] - Loading state
 */
export function HeatmapChart({ data = [], min = 0, max = 0, isLoading }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Peak Hours Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Peak Hours Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  // Create a map for quick lookup
  const dataMap = new Map(
    data.map((item) => [`${item.day}-${item.hour}`, item.consumption])
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Peak Hours Heatmap</CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-violet-200" />
            <span>Low</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-violet-400" />
            <span>Medium</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-violet-600" />
            <span>High</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* Hour labels (top) */}
            <div className="mb-1 flex">
              <div className="w-12 flex-shrink-0" />
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="w-8 flex-shrink-0 text-center text-xs text-muted-foreground"
                >
                  {hour}
                </div>
              ))}
            </div>

            {/* Heatmap grid */}
            {DAYS.map((day, dayIndex) => (
              <div key={dayIndex} className="mb-1 flex items-center">
                {/* Day label */}
                <div className="w-12 flex-shrink-0 text-xs text-muted-foreground">
                  {day}
                </div>

                {/* Hour cells */}
                {Array.from({ length: 24 }, (_, hour) => {
                  const value = dataMap.get(`${dayIndex}-${hour}`) || 0;
                  const colorClass = getColorClass(value, min, max);

                  return (
                    <div
                      key={hour}
                      className="group relative w-8 flex-shrink-0"
                      title={`${day} ${hour}:00 - ${value.toFixed(2)} kWh`}
                    >
                      <div
                        className={`h-6 rounded-sm ${colorClass} transition-opacity hover:opacity-80`}
                      />
                      {/* Tooltip on hover */}
                      <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white group-hover:block">
                        {day} {hour}:00
                        <br />
                        {value.toFixed(2)} kWh
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
