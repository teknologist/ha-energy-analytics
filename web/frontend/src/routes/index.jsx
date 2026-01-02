import { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import {
  useEntities,
  useStatistics,
  useDailySummary,
  useSyncData,
} from '@/hooks/useEnergy';
import { getTimeRange, formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EntitySelector } from '@/components/EntitySelector';
import { StatsCard } from '@/components/StatsCard';
import { EnergyChart } from '@/components/EnergyChart';

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

const timeRangeOptions = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

function DashboardPage() {
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [timeRange, setTimeRange] = useState('7d');

  const { data: entities = [] } = useEntities();
  const { data: statistics = [] } = useStatistics(selectedEntity, timeRange);
  const { data: dailySummary = [] } = useDailySummary(
    selectedEntity,
    timeRange
  );
  const syncMutation = useSyncData();

  const totalConsumption = useMemo(() => {
    if (!dailySummary.length) return 0;
    return dailySummary.reduce((sum, d) => sum + (d.total || 0), 0);
  }, [dailySummary]);

  const avgDaily = useMemo(() => {
    if (!dailySummary.length) return 0;
    return totalConsumption / dailySummary.length;
  }, [dailySummary, totalConsumption]);

  const peakUsage = useMemo(() => {
    if (!dailySummary.length) return 0;
    return Math.max(...dailySummary.map((d) => d.peak || 0));
  }, [dailySummary]);

  const handleSync = () => {
    syncMutation.mutate({
      entityIds: selectedEntity ? [selectedEntity] : [],
      startTime: getTimeRange(timeRange).toISOString(),
    });
  };

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center gap-4">
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
            {timeRangeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={handleSync} disabled={syncMutation.isPending}>
          <RefreshCw
            className={`mr-2 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`}
          />
          {syncMutation.isPending ? 'Syncing...' : 'Sync from HA'}
        </Button>
      </div>

      {selectedEntity ? (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Total Consumption"
              value={formatNumber(totalConsumption)}
              unit="kWh"
              icon="📊"
            />
            <StatsCard
              title="Daily Average"
              value={formatNumber(avgDaily)}
              unit="kWh"
              icon="📈"
            />
            <StatsCard
              title="Peak Usage"
              value={formatNumber(peakUsage)}
              unit="W"
              icon="⚡"
            />
            <StatsCard
              title="Data Points"
              value={statistics.length}
              unit="records"
              icon="💾"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {dailySummary.length > 0 && (
              <EnergyChart
                data={dailySummary}
                title="Daily Consumption"
                labelKey="date"
                valueKey="total"
                type="bar"
              />
            )}
            {statistics.length > 0 && (
              <EnergyChart
                data={statistics.slice(-168)}
                title="Hourly Readings"
                labelKey="start_time"
                valueKey="mean"
                type="line"
              />
            )}
          </div>
        </>
      ) : (
        <div className="py-16 text-center text-muted-foreground">
          <p>Select an entity to view energy statistics</p>
        </div>
      )}
    </>
  );
}
