# Component Library Quick Start

## Import Components

```jsx
// Recommended - centralized import
import { EnergyCard, Button, useToast } from '@/components';

// Alternative - direct import
import { EnergyCard } from '@/components/EnergyCard';
import { Button } from '@/components/ui/button';
```

## Custom Energy Components

### EnergyCard - With Trend Indicators
```jsx
<EnergyCard
  title="Total Consumption"
  value="245.3"
  unit="kWh"
  trend="up"           // 'up' | 'down' | 'neutral'
  trendValue={12.5}    // optional percentage
  icon={<Zap />}       // optional icon
/>
```

### StatusIndicator - Connection Status
```jsx
// Full variant
<StatusIndicator status="connected" label="Home Assistant" />

// Compact variant
<StatusIndicator status="connecting" variant="compact" />

// States: 'connected' | 'disconnected' | 'connecting' | 'error'
```

### StatCard - Enhanced Stats
```jsx
<StatCard
  title="Today's Usage"
  value="12.4 kWh"
  subtitle="Since midnight"
  icon={<Zap />}
  color="primary"      // 'default' | 'primary' | 'success' | 'warning' | 'danger'
/>
```

## Common UI Components

### Button
```jsx
<Button variant="default">Click Me</Button>
<Button variant="outline" size="sm">Small</Button>
<Button variant="destructive">Delete</Button>
```

### Card
```jsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>
    Content here
  </CardContent>
</Card>
```

### Toast Notifications
```jsx
import { useToast } from '@/components';

function MyComponent() {
  const { toast } = useToast();

  const showSuccess = () => {
    toast({
      title: 'Success',
      description: 'Operation completed',
    });
  };

  return <Button onClick={showSuccess}>Show Toast</Button>;
}
```

### Loading State
```jsx
<Card>
  <CardHeader>
    <Skeleton className="h-4 w-[200px]" />
  </CardHeader>
  <CardContent>
    <Skeleton className="h-8 w-full" />
  </CardContent>
</Card>
```

### Alert Messages
```jsx
<Alert variant="destructive">
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong</AlertDescription>
</Alert>
```

### Tabs
```jsx
<Tabs defaultValue="overview">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="stats">Statistics</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">
    Overview content
  </TabsContent>
  <TabsContent value="stats">
    Statistics content
  </TabsContent>
</Tabs>
```

## Dashboard Layout Example

```jsx
import {
  EnergyCard,
  StatCard,
  StatusIndicator,
  Button,
  useToast,
} from '@/components';
import { Zap, Activity, TrendingUp, RefreshCw } from 'lucide-react';

function Dashboard() {
  const { toast } = useToast();

  const handleSync = () => {
    toast({
      title: 'Syncing...',
      description: 'Fetching latest energy data',
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Energy Dashboard</h1>
        <div className="flex items-center gap-4">
          <StatusIndicator status="connected" label="Home Assistant" />
          <Button onClick={handleSync}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Sync
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <EnergyCard
          title="Total Consumption"
          value="245.3"
          unit="kWh"
          trend="up"
          trendValue={12.5}
          icon={<Zap />}
        />
        <StatCard
          title="Current Power"
          value="1.8 kW"
          subtitle="Active now"
          icon={<Activity />}
          color="primary"
        />
        <StatCard
          title="Peak Today"
          value="3.2 kW"
          subtitle="At 18:30"
          icon={<TrendingUp />}
          color="warning"
        />
      </div>
    </div>
  );
}
```

## Icons

All icons from lucide-react are available:
```jsx
import { Zap, Activity, TrendingUp, Home, Settings } from 'lucide-react';

<Zap className="h-4 w-4" />
```

Browse all icons: https://lucide.dev/icons/

## Color System

Tailwind colors available via CSS variables:
- `background` - Main background
- `foreground` - Main text
- `primary` - Primary brand color
- `secondary` - Secondary color
- `muted` - Muted text/backgrounds
- `accent` - Accent highlights
- `destructive` - Error/danger states
- `border` - Borders

Use in className:
```jsx
<div className="bg-primary text-primary-foreground">...</div>
<div className="border-border bg-card">...</div>
```

## Utilities

### cn() - Class Name Merger
```jsx
import { cn } from '@/lib/utils';

<div className={cn('base-class', isActive && 'active-class')}>
```

### formatEntityName()
```jsx
import { formatEntityName } from '@/lib/utils';

formatEntityName('sensor.total_power'); // "Total Power"
```

### formatNumber()
```jsx
import { formatNumber } from '@/lib/utils';

formatNumber(123.456, 2); // "123.46"
```

## Live Demo

See all components in action:
```
/Users/eric/Dev/energy-tracker/web/frontend/src/components/ComponentShowcase.jsx
```

## Full Documentation

For complete API reference, accessibility guidelines, and best practices:
```
/Users/eric/Dev/energy-tracker/web/frontend/COMPONENTS.md
```
