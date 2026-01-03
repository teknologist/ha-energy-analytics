import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

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
 * Custom tooltip for pie chart
 */
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background p-2 shadow-md">
      <p className="font-medium">{data.friendly_name}</p>
      <p className="text-sm text-muted-foreground">
        {data.consumption.toFixed(2)} {data.unit_of_measurement}
      </p>
      <p className="text-xs text-muted-foreground">
        {data.percentage.toFixed(1)}%
      </p>
    </div>
  );
}

/**
 * Donut chart for entity breakdown
 * @param {Object} props
 * @param {Array} props.data - Breakdown data from API
 * @param {boolean} [props.isLoading] - Loading state
 */
export function BreakdownChart({ data = [], isLoading }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Entity Breakdown</CardTitle>
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
          <CardTitle>Entity Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entity Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="consumption"
              label={({ friendly_name, percentage }) =>
                `${friendly_name}: ${percentage.toFixed(1)}%`
              }
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${entry.entity_id}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
