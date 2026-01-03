import { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  Settings,
  Database,
  Wifi,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import {
  useStatus,
  useEntities,
  useSyncData,
  useUpdateEntityTracked,
} from '@/hooks/useEnergy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDbInfo, setShowDbInfo] = useState(false);

  const {
    data: status,
    refetch: refetchStatus,
    isLoading: statusLoading,
    isFetching: statusFetching,
  } = useStatus();
  const { data: entities = [], isLoading: entitiesLoading } = useEntities();
  const syncMutation = useSyncData();
  const updateTrackedMutation = useUpdateEntityTracked();

  // Filter entities by search query
  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;
    const query = searchQuery.toLowerCase();
    return entities.filter(
      (entity) =>
        entity.name?.toLowerCase().includes(query) ||
        entity.entity_id?.toLowerCase().includes(query)
    );
  }, [entities, searchQuery]);

  // Count tracked entities
  const trackedCount = useMemo(() => {
    return entities.filter((e) => e.is_tracked).length;
  }, [entities]);

  // Handle individual toggle
  const handleToggleTracked = (entityId, currentState) => {
    updateTrackedMutation.mutate({
      entityId,
      tracked: !currentState,
    });
  };

  // Handle bulk track all - sequential to avoid race conditions
  const handleTrackAll = async () => {
    const entitiesToUpdate = filteredEntities.filter((e) => !e.is_tracked);
    for (const entity of entitiesToUpdate) {
      await updateTrackedMutation.mutateAsync({
        entityId: entity.entity_id,
        tracked: true,
      });
    }
  };

  // Handle bulk untrack all - sequential to avoid race conditions
  const handleUntrackAll = async () => {
    const entitiesToUpdate = filteredEntities.filter((e) => e.is_tracked);
    for (const entity of entitiesToUpdate) {
      await updateTrackedMutation.mutateAsync({
        entityId: entity.entity_id,
        tracked: false,
      });
    }
  };

  // Handle full sync
  const handleFullSync = () => {
    const trackedEntities = entities.filter((e) => e.is_tracked);
    if (trackedEntities.length === 0) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    syncMutation.mutate({
      entityIds: trackedEntities.map((e) => e.entity_id),
      startTime: thirtyDaysAgo.toISOString(),
    });
  };

  // Format last seen time
  const formatLastSeen = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  // Connection status indicator
  const getConnectionStatus = (connected) => {
    if (connected === undefined || statusLoading) {
      return {
        color: 'bg-yellow-500',
        text: 'Connecting',
        icon: Clock,
      };
    }
    return connected
      ? { color: 'bg-green-500', text: 'Connected', icon: CheckCircle2 }
      : { color: 'bg-red-500', text: 'Disconnected', icon: XCircle };
  };

  const haStatus = getConnectionStatus(status?.homeAssistant?.connected);
  const StatusIcon = haStatus.icon;

  return (
    <>
      <div className="mb-6 flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Settings</h2>
      </div>

      {/* Connection Status */}
      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wifi className="h-4 w-4" />
              Home Assistant Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusLoading ? (
              <>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${haStatus.color} ${statusFetching ? 'animate-pulse' : ''}`}
                    />
                    <StatusIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{haStatus.text}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">URL</span>
                  <span className="text-sm font-mono">
                    {status?.homeAssistant?.url || 'Not configured'}
                  </span>
                </div>
                {status?.homeAssistant?.lastSeen && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Last Seen
                    </span>
                    <span className="text-sm">
                      {formatLastSeen(status.homeAssistant.lastSeen)}
                    </span>
                  </div>
                )}
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => refetchStatus()}
              disabled={statusFetching}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${statusFetching ? 'animate-spin' : ''}`}
              />
              Refresh Status
            </Button>
          </CardContent>
        </Card>

        {/* Data Sync */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              Data Synchronization
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Tracked Entities
              </span>
              <Badge variant="secondary">
                {trackedCount} of {entities.length}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sync Period</span>
              <span className="text-sm">30 days</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleFullSync}
              disabled={syncMutation.isPending || trackedCount === 0}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`}
              />
              {syncMutation.isPending
                ? 'Syncing...'
                : `Sync ${trackedCount} ${trackedCount === 1 ? 'Entity' : 'Entities'}`}
            </Button>
            {syncMutation.isSuccess && (
              <p className="text-xs text-green-600">
                Sync completed successfully
              </p>
            )}
            {syncMutation.isError && (
              <p className="text-xs text-red-600">
                Sync failed: {syncMutation.error?.message || 'Unknown error'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Entity Management */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Entity Tracking</CardTitle>
          <p className="text-sm text-muted-foreground">
            Select which entities to track for statistics and insights
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search and Bulk Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search entities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTrackAll}
                disabled={
                  filteredEntities.every((e) => e.is_tracked) || entitiesLoading
                }
              >
                Track All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUntrackAll}
                disabled={
                  filteredEntities.every((e) => !e.is_tracked) ||
                  entitiesLoading
                }
              >
                Untrack All
              </Button>
            </div>
          </div>

          {/* Entity Table */}
          {entitiesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredEntities.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery
                ? `No entities match "${searchQuery}"`
                : 'No entities available. Connect to Home Assistant to discover energy sensors.'}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b">
                      <th className="text-left text-sm font-medium p-3">
                        Entity
                      </th>
                      <th className="text-left text-sm font-medium p-3 hidden md:table-cell">
                        Entity ID
                      </th>
                      <th className="text-left text-sm font-medium p-3 hidden sm:table-cell">
                        Unit
                      </th>
                      <th className="text-right text-sm font-medium p-3">
                        Tracked
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntities.map((entity) => (
                      <tr
                        key={entity.entity_id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {entity.name || entity.entity_id}
                            </span>
                            <span className="text-xs text-muted-foreground md:hidden font-mono">
                              {entity.entity_id}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 hidden md:table-cell">
                          <span className="text-sm font-mono text-muted-foreground">
                            {entity.entity_id}
                          </span>
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          <Badge variant="outline" className="text-xs">
                            {entity.unit_of_measurement || 'N/A'}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end items-center gap-2">
                            <Label
                              htmlFor={`track-${entity.entity_id}`}
                              className="sr-only"
                            >
                              Track {entity.name || entity.entity_id}
                            </Label>
                            <Switch
                              id={`track-${entity.entity_id}`}
                              checked={entity.is_tracked || false}
                              onCheckedChange={() =>
                                handleToggleTracked(
                                  entity.entity_id,
                                  entity.is_tracked
                                )
                              }
                              disabled={updateTrackedMutation.isPending}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results count */}
          {!entitiesLoading && filteredEntities.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Showing {filteredEntities.length} of {entities.length} entities
              {searchQuery && ` matching "${searchQuery}"`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Database Info (Collapsible) */}
      <Card>
        <CardHeader>
          <button
            onClick={() => setShowDbInfo(!showDbInfo)}
            className="flex items-center justify-between w-full text-left"
          >
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              Database Information
            </CardTitle>
            <RefreshCw
              className={`h-4 w-4 transition-transform ${showDbInfo ? 'rotate-180' : ''}`}
            />
          </button>
        </CardHeader>
        {showDbInfo && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium mb-2">MongoDB</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          status?.mongodb?.connected
                            ? 'bg-green-500'
                            : 'bg-red-500'
                        }`}
                      />
                      <span>
                        {status?.mongodb?.connected
                          ? 'Connected'
                          : 'Disconnected'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Database</span>
                    <span className="font-mono text-xs">
                      {status?.mongodb?.database || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">QuestDB</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          status?.questdb?.connected
                            ? 'bg-green-500'
                            : 'bg-red-500'
                        }`}
                      />
                      <span>
                        {status?.questdb?.connected
                          ? 'Connected'
                          : 'Disconnected'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Version</span>
                    <span className="font-mono text-xs">
                      {status?.questdb?.version || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            {entities._meta && (
              <div className="pt-4 border-t">
                <h4 className="text-sm font-medium mb-2">Cache Info</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <Badge
                      variant={
                        entities._meta.source === 'live'
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {entities._meta.source}
                    </Badge>
                  </div>
                  {entities._meta.degraded && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Mode</span>
                      <Badge variant="outline" className="text-yellow-600">
                        Degraded
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </>
  );
}
