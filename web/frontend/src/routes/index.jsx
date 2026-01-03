import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Zap, TrendingUp, Activity, Flame } from 'lucide-react';
import {
  useTopConsumers,
  usePeakConsumption,
  useConsumptionPatterns,
  useEntityBreakdown,
  useConsumptionTimeline,
  useHeatmapData,
} from '@/hooks/useEnergy';
import { formatNumber } from '@/lib/utils';
import { PeriodSelector } from '@/components/PeriodSelector';
import { KPICard } from '@/components/KPICard';
import { ConsumptionChart } from '@/components/ConsumptionChart';
import { BreakdownChart } from '@/components/BreakdownChart';
import { HeatmapChart } from '@/components/HeatmapChart';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const Route = createFileRoute('/')({
  component: DashboardWithErrorBoundary,
});

function DashboardWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <DashboardPage />
    </ErrorBoundary>
  );
}

function DashboardPage() {
  const [period, setPeriod] = useState('week');

  // Fetch insights data
  const { data: topConsumersData, isLoading: isLoadingTopConsumers } =
    useTopConsumers(period, 5);
  const { data: peakData, isLoading: isLoadingPeak } =
    usePeakConsumption(period);
  const { data: patternsData, isLoading: isLoadingPatterns } =
    useConsumptionPatterns(period);
  const { data: breakdownData, isLoading: isLoadingBreakdown } =
    useEntityBreakdown(period);
  const { data: timelineData, isLoading: isLoadingTimeline } =
    useConsumptionTimeline(period, 'hour');
  const { data: heatmapData, isLoading: isLoadingHeatmap } =
    useHeatmapData(period);

  // Extract data for KPI cards
  const totalConsumption = topConsumersData?.total_consumption || 0;
  const peakConsumer = topConsumersData?.top_consumers?.[0];
  const topBurster = patternsData?.burst_consumers?.[0];

  // For "Current Power", we'd need real-time data from a different endpoint
  // For now, show peak value as placeholder
  const currentPower = peakData?.peak?.value || 0;

  return (
    <>
      {/* Header with Period Selector */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Energy Dashboard</h1>
          <p className="text-muted-foreground">
            Consumption insights and analytics
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* KPI Cards Row */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Energy"
          value={formatNumber(totalConsumption)}
          unit="kWh"
          icon={<Zap className="h-5 w-5 text-violet-500" />}
          isLoading={isLoadingTopConsumers}
        />

        <KPICard
          title="Current Power"
          value={formatNumber(currentPower)}
          unit="W"
          icon={<Activity className="h-5 w-5 text-blue-500" />}
          isLoading={isLoadingPeak}
          isLive={true}
        />

        <KPICard
          title="Peak Consumer"
          value={peakConsumer?.friendly_name || 'N/A'}
          subtitle={
            peakConsumer
              ? `${formatNumber(peakConsumer.consumption)} kWh (${peakConsumer.percentage.toFixed(1)}%)`
              : undefined
          }
          icon={<TrendingUp className="h-5 w-5 text-green-500" />}
          isLoading={isLoadingTopConsumers}
        />

        <KPICard
          title="Top Burster"
          value={topBurster?.friendly_name || 'N/A'}
          subtitle={
            topBurster
              ? `Variance: ${topBurster.variance.toFixed(2)}`
              : undefined
          }
          icon={<Flame className="h-5 w-5 text-amber-500" />}
          isLoading={isLoadingPatterns}
        />
      </div>

      {/* Charts Section - 2 column grid */}
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <ConsumptionChart
          data={timelineData?.timeline || []}
          isLoading={isLoadingTimeline}
        />

        <BreakdownChart
          data={breakdownData?.breakdown || []}
          isLoading={isLoadingBreakdown}
        />
      </div>

      {/* Heatmap Section - Full width */}
      <div className="mb-8">
        <HeatmapChart
          data={heatmapData?.heatmap || []}
          min={heatmapData?.min_consumption || 0}
          max={heatmapData?.max_consumption || 0}
          isLoading={isLoadingHeatmap}
        />
      </div>
    </>
  );
}
