import { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Calendar, Download, TrendingUp } from 'lucide-react';
import { useEntities, useMultiEntityStatistics } from '@/hooks/useEnergy';
import { formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangePicker } from '@/components/DateRangePicker';
import { MultiEntitySelector } from '@/components/MultiEntitySelector';
import { StatisticsTable } from '@/components/StatisticsTable';
import { exportToCsv } from '@/lib/exportCsv';
import { format, subDays } from 'date-fns';

export const Route = createFileRoute('/history')({
  component: HistoryPage,
});

function HistoryPage() {
  // Default: Last 7 days
  const [startDate, setStartDate] = useState(() => subDays(new Date(), 7));
  const [endDate, setEndDate] = useState(() => new Date());
  const [selectedEntityIds, setSelectedEntityIds] = useState([]);

  // Fetch entities (only tracked)
  const { data: allEntities = [], isLoading: entitiesLoading } = useEntities();
  const trackedEntities = useMemo(
    () => allEntities.filter((e) => e.is_tracked),
    [allEntities]
  );

  // Fetch statistics for selected entities
  const {
    data: statsResponse,
    isLoading: statsLoading,
    error: statsError,
  } = useMultiEntityStatistics(selectedEntityIds, {
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
  });

  const statistics = statsResponse?.statistics || [];

  // Create entity map for quick lookups
  const entityMap = useMemo(() => {
    const map = new Map();
    trackedEntities.forEach((e) => map.set(e.entity_id, e));
    return map;
  }, [trackedEntities]);

  // Calculate summary statistics
  const summary = useMemo(() => {
    if (!statistics.length) {
      return {
        totalConsumption: 0,
        avgDaily: 0,
        peak: { value: 0, timestamp: null, entity: null },
        rowCount: 0,
      };
    }

    const totalSum = statistics.reduce((acc, s) => acc + (s.sum || 0), 0);
    const daysDiff = Math.max(
      1,
      Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
    );
    const avgDaily = totalSum / daysDiff;

    // Find peak
    const peak = statistics.reduce(
      (max, s) =>
        s.max > max.value
          ? {
              value: s.max,
              timestamp: s.timestamp || s.start_time,
              entity: s.entity_id,
            }
          : max,
      { value: 0, timestamp: null, entity: null }
    );

    return {
      totalConsumption: totalSum,
      avgDaily,
      peak,
      rowCount: statistics.length,
    };
  }, [statistics, startDate, endDate]);

  // Handle date range change
  const handleDateRangeChange = ({ startDate: newStart, endDate: newEnd }) => {
    setStartDate(newStart);
    setEndDate(newEnd);
  };

  // Handle CSV export with error handling
  const handleExport = () => {
    if (!statistics.length) return;

    const filename = `energy-export-${format(startDate, 'yyyy-MM-dd')}-to-${format(endDate, 'yyyy-MM-dd')}.csv`;
    const result = exportToCsv(statistics, entityMap, filename);

    if (!result.success) {
      console.error('CSV export failed:', result.error);
      // Could show a toast notification here
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Calendar className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Historical Data Explorer</h2>
      </div>

      {/* Date Range Picker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Date Range</CardTitle>
        </CardHeader>
        <CardContent>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={handleDateRangeChange}
            maxRangeDays={365}
          />
        </CardContent>
      </Card>

      {/* Entity Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Entities</CardTitle>
        </CardHeader>
        <CardContent>
          {entitiesLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <MultiEntitySelector
              entities={trackedEntities}
              selectedIds={selectedEntityIds}
              onChange={setSelectedEntityIds}
            />
          )}
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      {selectedEntityIds.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Consumption
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  `${formatNumber(summary.totalConsumption)} kWh`
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg Daily
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  `${formatNumber(summary.avgDaily)} kWh`
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Peak Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  `${formatNumber(summary.peak.value)} kWh`
                )}
              </div>
              {summary.peak.timestamp && (
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(summary.peak.timestamp), 'MMM dd, HH:mm')}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Data Points
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  formatNumber(summary.rowCount, 0)
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedEntityIds.length} entities
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Export Button */}
      {selectedEntityIds.length > 0 && statistics.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={handleExport} disabled={statsLoading}>
            <Download className="mr-2 h-4 w-4" />
            Export Full Dataset to CSV
          </Button>
        </div>
      )}

      {/* Data Table */}
      {selectedEntityIds.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <TrendingUp className="mx-auto h-12 w-12 mb-4 opacity-20" />
            <p>Select entities and a date range to view historical data</p>
          </CardContent>
        </Card>
      ) : statsLoading ? (
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ) : statsError ? (
        <Card>
          <CardContent className="py-16 text-center text-destructive">
            <p>Error loading statistics: {statsError.message}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statistics Data</CardTitle>
          </CardHeader>
          <CardContent>
            <StatisticsTable
              data={statistics}
              entityMap={entityMap}
              pageSize={50}
              maxDisplayRows={200}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
