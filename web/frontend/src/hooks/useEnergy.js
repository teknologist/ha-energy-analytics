import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchEntities,
  fetchStatistics,
  fetchDailySummary,
  fetchStatus,
  syncData,
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
