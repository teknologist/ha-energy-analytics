/**
 * ComponentShowcase - Example usage of all shadcn/ui and custom energy components
 * This file serves as a reference for developers implementing the Energy Dashboard UI
 */

import {
  EnergyCard,
  StatusIndicator,
  StatCard,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Alert,
  AlertDescription,
  AlertTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@/components';
import {
  Zap,
  Lightbulb,
  TrendingUp,
  Activity,
  AlertCircle,
} from 'lucide-react';

export function ComponentShowcase() {
  const { toast } = useToast();

  const showToast = () => {
    toast({
      title: 'Success',
      description: 'Energy data synced successfully',
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold mb-6">Component Showcase</h1>

      {/* Status Indicators Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Status Indicators</h2>
        <div className="flex flex-wrap gap-4">
          <StatusIndicator status="connected" label="Home Assistant" />
          <StatusIndicator status="disconnected" label="QuestDB" />
          <StatusIndicator status="connecting" label="MongoDB" />
          <StatusIndicator status="error" label="Sync Failed" />
          <StatusIndicator status="connected" variant="compact" />
        </div>
      </section>

      {/* EnergyCard Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Energy Cards</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <EnergyCard
            title="Total Consumption"
            value="245.3"
            unit="kWh"
            trend="up"
            trendValue={12.5}
            icon={<Zap />}
          />
          <EnergyCard
            title="Current Power"
            value="1.8"
            unit="kW"
            trend="down"
            trendValue={8.2}
            icon={<Activity />}
          />
          <EnergyCard
            title="Average Usage"
            value="3.2"
            unit="kWh"
            trend="neutral"
            icon={<TrendingUp />}
          />
        </div>
      </section>

      {/* StatCard Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Stat Cards</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Today's Usage"
            value="12.4 kWh"
            subtitle="Since midnight"
            icon={<Zap />}
            color="primary"
          />
          <StatCard
            title="Peak Power"
            value="3.2 kW"
            subtitle="At 18:30"
            icon={<TrendingUp />}
            color="warning"
          />
          <StatCard
            title="Cost Saved"
            value="$24.50"
            subtitle="This month"
            icon={<Lightbulb />}
            color="success"
          />
          <StatCard
            title="Devices Active"
            value="8"
            subtitle="Currently on"
            icon={<Activity />}
            color="default"
          />
        </div>
      </section>

      {/* Badges Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Badges</h2>
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </section>

      {/* Buttons Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Buttons</h2>
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button onClick={showToast}>Show Toast</Button>
        </div>
      </section>

      {/* Alerts Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Alerts</h2>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Information</AlertTitle>
          <AlertDescription>
            This is an informational alert showing system status.
          </AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Failed to connect to Home Assistant. Please check your connection.
          </AlertDescription>
        </Alert>
      </section>

      {/* Tabs Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Tabs</h2>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="statistics">Statistics</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Overview Tab</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  This is the overview tab content.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="statistics">
            <Card>
              <CardHeader>
                <CardTitle>Statistics Tab</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Statistics and analytics will be displayed here.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Settings Tab</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Configuration options will be shown here.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      {/* Skeleton Loaders Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Loading Skeletons</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-[200px]" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-[150px]" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-[180px]" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-[120px]" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-[160px]" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-[140px]" />
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
