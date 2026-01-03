import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchEntities,
  fetchStatistics,
  fetchDailySummary,
  fetchStatus,
  syncData,
  updateEntityTracked,
  fetchTopConsumers,
  fetchPeakConsumption,
  fetchConsumptionPatterns,
  fetchEntityBreakdown,
  fetchConsumptionTimeline,
  fetchHeatmapData,
} from '@/lib/api';
import { getTimeRange } from '@/lib/utils';

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 30000, // Poll every 30s
    retry: false,
  });
}

export function useEntities() {
  return useQuery({
    queryKey: ['entities'],
    queryFn: fetchEntities,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

export function useStatistics(entityId, timeRange) {
  const startTime = getTimeRange(timeRange).toISOString();
  const endTime = new Date().toISOString();

  return useQuery({
    queryKey: ['statistics', entityId, timeRange],
    queryFn: () => fetchStatistics(entityId, startTime, endTime),
    enabled: !!entityId,
    refetchInterval: 60000, // Poll every minute
  });
}

export function useDailySummary(entityId, timeRange) {
  const startTime = getTimeRange(timeRange).toISOString();
  const endTime = new Date().toISOString();

  return useQuery({
    queryKey: ['dailySummary', entityId, timeRange],
    queryFn: () => fetchDailySummary(entityId, startTime, endTime),
    enabled: !!entityId,
    refetchInterval: 60000,
  });
}

export function useSyncData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entityIds, startTime }) => syncData(entityIds, startTime),
    onSuccess: () => {
      // Invalidate and refetch statistics after sync
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      queryClient.invalidateQueries({ queryKey: ['dailySummary'] });
    },
  });
}

export function useUpdateEntityTracked() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entityId, tracked }) =>
      updateEntityTracked(entityId, tracked),
    onMutate: async ({ entityId, tracked }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['entities'] });

      // Snapshot previous value
      const previousEntities = queryClient.getQueryData(['entities']);

      // Optimistically update cache (entities is an array with _meta)
      queryClient.setQueryData(['entities'], (old) => {
        if (!Array.isArray(old)) return old;

        const updated = old.map((entity) =>
          entity.entity_id === entityId
            ? { ...entity, is_tracked: tracked }
            : entity
        );

        // Preserve metadata
        if (old._meta) {
          updated._meta = old._meta;
        }

        return updated;
      });

      return { previousEntities };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousEntities) {
        queryClient.setQueryData(['entities'], context.previousEntities);
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['entities'] });
    },
  });
}

export function useTopConsumers(period = 'week', limit = 5) {
  return useQuery({
    queryKey: ['topConsumers', period, limit],
    queryFn: () => fetchTopConsumers(period, limit),
    staleTime: 60000, // Cache for 1 minute
  });
}

export function usePeakConsumption(period = 'week') {
  return useQuery({
    queryKey: ['peakConsumption', period],
    queryFn: () => fetchPeakConsumption(period),
    staleTime: 60000,
  });
}

export function useConsumptionPatterns(period = 'week') {
  return useQuery({
    queryKey: ['patterns', period],
    queryFn: () => fetchConsumptionPatterns(period),
    staleTime: 60000,
  });
}

export function useEntityBreakdown(period = 'week') {
  return useQuery({
    queryKey: ['breakdown', period],
    queryFn: () => fetchEntityBreakdown(period),
    staleTime: 60000,
  });
}

export function useConsumptionTimeline(period = 'week', groupBy = 'hour') {
  return useQuery({
    queryKey: ['timeline', period, groupBy],
    queryFn: () => fetchConsumptionTimeline(period, groupBy),
    staleTime: 60000,
  });
}

export function useHeatmapData(period = 'week') {
  return useQuery({
    queryKey: ['heatmap', period],
    queryFn: () => fetchHeatmapData(period),
    staleTime: 60000,
  });
}

export function useMultiEntityStatistics(entityIds, { startTime, endTime }) {
  return useQuery({
    queryKey: ['multi-statistics', entityIds, startTime, endTime],
    queryFn: async ({ signal }) => {
      if (!entityIds?.length) return { statistics: [] };

      // Fetch in parallel for all entities with AbortController support
      const results = await Promise.all(
        entityIds.map(async (entityId) => {
          const res = await fetch(
            `/api/statistics/${encodeURIComponent(entityId)}?start_time=${startTime}&end_time=${endTime}`,
            { signal }
          );
          if (!res.ok) throw new Error(`Failed to fetch ${entityId}`);
          const data = await res.json();
          return (
            data.data?.statistics?.map((s) => ({
              ...s,
              entity_id: entityId,
            })) || []
          );
        })
      );

      // Flatten and sort by timestamp desc
      const allStats = results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.timestamp || b.start_time) -
            new Date(a.timestamp || a.start_time)
        );

      return { statistics: allStats };
    },
    enabled: entityIds?.length > 0,
    staleTime: 60000,
  });
}
