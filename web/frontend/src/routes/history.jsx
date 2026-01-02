import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Calendar, Download } from 'lucide-react';
import { useEntities, useStatistics } from '@/hooks/useEnergy';
import { formatNumber, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntitySelector } from '@/components/EntitySelector';

export const Route = createFileRoute('/history')({
  component: HistoryPage,
});

function HistoryPage() {
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [timeRange, setTimeRange] = useState('30d');

  const { data: entities = [] } = useEntities();
  const { data: statistics = [] } = useStatistics(selectedEntity, timeRange);

  const handleExport = () => {
    if (!statistics.length) return;

    const csv = [
      ['Timestamp', 'Mean (kWh)', 'Min (kWh)', 'Max (kWh)', 'Sum (kWh)'].join(
        ','
      ),
      ...statistics.map((row) =>
        [row.start_time, row.mean, row.min, row.max, row.sum].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `energy-history-${selectedEntity}-${timeRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Historical Data</h2>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <EntitySelector
          entities={entities}
          value={selectedEntity}
          onValueChange={setSelectedEntity}
        />

        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="365d">Last year</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          onClick={handleExport}
          disabled={!statistics.length}
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {selectedEntity && statistics.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {statistics.length} records found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Timestamp</th>
                    <th className="py-2 text-right font-medium">Mean</th>
                    <th className="py-2 text-right font-medium">Min</th>
                    <th className="py-2 text-right font-medium">Max</th>
                    <th className="py-2 text-right font-medium">Sum</th>
                  </tr>
                </thead>
                <tbody>
                  {statistics.slice(0, 200).map((row, idx) => (
                    <tr key={idx} className="border-b border-border/50">
                      <td className="py-2 text-muted-foreground">
                        {formatDate(row.start_time)}
                      </td>
                      <td className="py-2 text-right">
                        {formatNumber(row.mean)} kWh
                      </td>
                      <td className="py-2 text-right text-muted-foreground">
                        {formatNumber(row.min)}
                      </td>
                      <td className="py-2 text-right text-muted-foreground">
                        {formatNumber(row.max)}
                      </td>
                      <td className="py-2 text-right font-medium">
                        {formatNumber(row.sum)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {statistics.length > 200 && (
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Showing first 200 of {statistics.length} records. Export to
                  CSV for full data.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="py-16 text-center text-muted-foreground">
          <p>Select an entity to view historical data</p>
        </div>
      )}
    </>
  );
}
