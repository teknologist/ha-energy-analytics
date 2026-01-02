import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { Zap, LayoutDashboard, Settings, History } from 'lucide-react';
import { useStatus } from '@/hooks/useEnergy';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const { data: status } = useStatus();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Zap className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-semibold">Energy Dashboard</h1>
            </div>
            <nav className="flex items-center gap-4">
              <Link
                to="/"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
              <Link
                to="/history"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
              >
                <History className="h-4 w-4" />
                History
              </Link>
              <Link
                to="/settings"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${status?.homeAssistant?.connected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-sm text-muted-foreground">
              HA:{' '}
              {status?.homeAssistant?.connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
