import { createFileRoute } from '@tanstack/react-router';
import { Settings, Database, Wifi, RefreshCw } from 'lucide-react';
import { useStatus, useEntities, useSyncData } from '@/hooks/useEnergy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const { data: status, refetch: refetchStatus } = useStatus();
  const { data: entities = [] } = useEntities();
  const syncMutation = useSyncData();

  const handleFullSync = () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    syncMutation.mutate({
      entityIds: entities.map((e) => e.entity_id),
      startTime: thirtyDaysAgo.toISOString(),
    });
  };

  return (
    <>
      <div className="mb-6 flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Settings</h2>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wifi className="h-4 w-4" />
              Home Assistant Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${status?.homeAssistant?.connected ? 'bg-green-500' : 'bg-red-500'}`}
                />
                <span className="text-sm">
                  {status?.homeAssistant?.connected
                    ? 'Connected'
                    : 'Disconnected'}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">URL</span>
              <span className="text-sm font-mono">
                {status?.homeAssistant?.url || 'Not configured'}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => refetchStatus()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Status
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              Local Database
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Cached Entities
              </span>
              <span className="text-sm font-medium">{entities.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Database Path
              </span>
              <span className="text-sm font-mono">./data/energy.db</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleFullSync}
              disabled={syncMutation.isPending || entities.length === 0}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`}
              />
              {syncMutation.isPending
                ? 'Syncing...'
                : 'Sync All Entities (30 days)'}
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Available Entities</CardTitle>
          </CardHeader>
          <CardContent>
            {entities.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {entities.map((entity) => (
                  <div
                    key={entity.entity_id}
                    className="rounded-md border border-border p-3"
                  >
                    <p className="text-sm font-medium">
                      {entity.name || entity.entity_id}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {entity.entity_id}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No entities cached. Connect to Home Assistant to discover energy
                sensors.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
