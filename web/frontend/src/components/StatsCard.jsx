import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function StatsCard({ title, value, unit, icon }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-xl">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {value}{' '}
          <span className="text-sm font-normal text-muted-foreground">
            {unit}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
