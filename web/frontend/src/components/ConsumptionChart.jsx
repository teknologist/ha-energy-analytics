import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const COLORS = [
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#6366f1', // indigo
];

/**
 * Custom tooltip for stacked area chart
 */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="mb-2 font-medium">{new Date(label).toLocaleString()}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="h-3 w-3 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">
            {entry.name}: {entry.value.toFixed(2)} kWh
          </span>
        </div>
      ))}
      <div className="mt-2 border-t pt-2 text-sm font-medium">
        Total: {payload.reduce((sum, p) => sum + p.value, 0).toFixed(2)} kWh
      </div>
    </div>
  );
}

/**
 * Stacked area chart for consumption timeline
 * @param {Object} props
 * @param {Array} props.data - Timeline data with breakdown per entity
 * @param {boolean} [props.isLoading] - Loading state
 */
export function ConsumptionChart({ data = [], isLoading }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Consumption Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Consumption Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  // Extract unique entity IDs from breakdown data
  const entityIds = new Set();
  data.forEach((entry) => {
    if (entry.breakdown) {
      Object.keys(entry.breakdown).forEach((id) => entityIds.add(id));
    }
  });

  const entities = Array.from(entityIds);

  // Transform data for Recharts stacked area
  const chartData = data.map((entry) => {
    const point = { time: entry.time };
    entities.forEach((entityId) => {
      point[entityId] = entry.breakdown?.[entityId]?.consumption || 0;
    });
    return point;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consumption Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="time"
              tickFormatter={(time) => {
                const date = new Date(time);
                return date.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                });
              }}
              className="text-xs"
            />
            <YAxis className="text-xs" label={{ value: 'kWh', angle: -90 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {entities.map((entityId, index) => (
              <Area
                key={entityId}
                type="monotone"
                dataKey={entityId}
                stackId="1"
                stroke={COLORS[index % COLORS.length]}
                fill={COLORS[index % COLORS.length]}
                fillOpacity={0.6}
                name={data[0]?.breakdown?.[entityId]?.friendly_name || entityId}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
