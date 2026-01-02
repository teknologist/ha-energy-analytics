import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const chartStyles = {
  backgroundColor: 'hsl(222 47% 11%)',
  border: '1px solid hsl(215 20% 25%)',
  borderRadius: '8px',
};

export function EnergyChart({ data, title, labelKey, valueKey, type = 'bar' }) {
  const formatLabel = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (type === 'bar') {
      return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleTimeString('en', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const chartData = data.map((item) => ({
    ...item,
    label: formatLabel(item[labelKey]),
    value: item[valueKey] || 0,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          {type === 'bar' ? (
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 20% 25%)" />
              <XAxis
                dataKey="label"
                stroke="hsl(215 20% 65%)"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="hsl(215 20% 65%)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={chartStyles}
                labelStyle={{ color: 'hsl(213 31% 91%)' }}
                formatter={(value) => [
                  `${Number(value).toFixed(2)} kWh`,
                  'Consumption',
                ]}
              />
              <Bar
                dataKey="value"
                fill="hsl(217 91% 60%)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          ) : (
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 20% 25%)" />
              <XAxis
                dataKey="label"
                stroke="hsl(215 20% 65%)"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="hsl(215 20% 65%)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={chartStyles}
                labelStyle={{ color: 'hsl(213 31% 91%)' }}
                formatter={(value) => [`${Number(value).toFixed(2)}`, 'Power']}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(142 71% 45%)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
