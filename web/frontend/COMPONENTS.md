# Component Library Documentation

This document provides a comprehensive guide to the shadcn/ui components and custom energy components available in the Energy Dashboard frontend.

## Table of Contents

1. [Setup](#setup)
2. [Custom Energy Components](#custom-energy-components)
3. [shadcn/ui Components](#shadcnui-components)
4. [Usage Examples](#usage-examples)
5. [Accessibility](#accessibility)

## Setup

The component library is built on:
- **shadcn/ui** - High-quality, accessible components built with Radix UI
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Icon library
- **React** - Component framework

### Installation

All components are already installed. To add new shadcn/ui components:

```bash
cd web/frontend
npx shadcn@latest add [component-name]
```

### Imports

Components can be imported from the central index:

```jsx
import { EnergyCard, Button, useToast } from '@/components';
```

Or directly:

```jsx
import { EnergyCard } from '@/components/EnergyCard';
import { Button } from '@/components/ui/button';
```

## Custom Energy Components

### EnergyCard

A card component for displaying energy metrics with trend indicators.

**Props:**
- `title` (string) - Card title
- `value` (string|number) - Main value to display
- `unit` (string) - Unit of measurement (e.g., "kWh", "W")
- `trend` ('up'|'down'|'neutral') - Trend direction (default: 'neutral')
- `trendValue` (number, optional) - Trend percentage or value
- `icon` (ReactNode, optional) - Icon component
- `className` (string, optional) - Additional CSS classes

**Example:**
```jsx
import { EnergyCard } from '@/components';
import { Zap } from 'lucide-react';

<EnergyCard
  title="Total Consumption"
  value="245.3"
  unit="kWh"
  trend="up"
  trendValue={12.5}
  icon={<Zap />}
/>
```

**Features:**
- Color-coded trend indicators (red=increased, green=decreased)
- Animated trend icons
- Responsive design
- Accessible with proper ARIA labels

### StatusIndicator

Connection/status indicator component with multiple variants.

**Props:**
- `status` ('connected'|'disconnected'|'connecting'|'error') - Current status
- `label` (string, optional) - Optional label text
- `variant` ('default'|'compact') - Display variant (default: 'default')
- `className` (string, optional) - Additional CSS classes

**Example:**
```jsx
import { StatusIndicator } from '@/components';

<StatusIndicator status="connected" label="Home Assistant" />
<StatusIndicator status="connecting" variant="compact" />
```

**Features:**
- Animated loading states (spinner for 'connecting', pulse for 'error')
- Color-coded status (green=connected, red=disconnected, blue=connecting, amber=error)
- Compact variant for space-constrained layouts

### StatCard

Enhanced statistics display card with color variants and subtitles.

**Props:**
- `title` (string) - Card title
- `value` (string|number) - Main value to display
- `subtitle` (string, optional) - Optional subtitle or description
- `icon` (ReactNode, optional) - Icon component
- `color` ('default'|'primary'|'success'|'warning'|'danger') - Color variant
- `className` (string, optional) - Additional CSS classes

**Example:**
```jsx
import { StatCard } from '@/components';
import { Zap } from 'lucide-react';

<StatCard
  title="Today's Usage"
  value="12.4 kWh"
  subtitle="Since midnight"
  icon={<Zap />}
  color="primary"
/>
```

**Features:**
- Five color variants for different metric types
- Optional subtitle for context
- Icon support
- Consistent sizing with other stat cards

## shadcn/ui Components

### Installed Components

The following shadcn/ui components are available:

#### Layout Components
- **Card** - Container component with header, content, footer sections
- **Alert** - Alert messages with variants
- **Tabs** - Tabbed navigation component

#### Form Components
- **Button** - Button with multiple variants and sizes
- **Input** - Text input field
- **Label** - Form label
- **Select** - Dropdown select component
- **Switch** - Toggle switch

#### Feedback Components
- **Badge** - Small status or label indicator
- **Toast** - Toast notifications (via useToast hook)
- **Sonner** - Alternative toast implementation
- **Skeleton** - Loading placeholder

#### Overlay Components
- **Dialog** - Modal dialog
- **DropdownMenu** - Dropdown menu component

### Common Patterns

#### Button Variants
```jsx
import { Button } from '@/components';

<Button>Default</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Destructive</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
```

#### Card Structure
```jsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components';

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
  </CardHeader>
  <CardContent>
    Content goes here
  </CardContent>
</Card>
```

#### Toast Notifications
```jsx
import { useToast } from '@/components';

function MyComponent() {
  const { toast } = useToast();

  const showNotification = () => {
    toast({
      title: 'Success',
      description: 'Operation completed successfully',
    });
  };

  return <Button onClick={showNotification}>Show Toast</Button>;
}
```

#### Tabs
```jsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components';

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

## Usage Examples

### Dashboard Grid Layout
```jsx
import { EnergyCard, StatCard } from '@/components';
import { Zap, Activity, TrendingUp } from 'lucide-react';

function DashboardGrid() {
  return (
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
  );
}
```

### Loading States
```jsx
import { Card, CardHeader, CardContent, Skeleton } from '@/components';

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-[200px]" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-[150px]" />
      </CardContent>
    </Card>
  );
}
```

### Error Handling
```jsx
import { Alert, AlertTitle, AlertDescription } from '@/components';
import { AlertCircle } from 'lucide-react';

function ErrorAlert({ message }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
```

## Accessibility

All components follow WCAG 2.1 Level AA guidelines:

### Keyboard Navigation
- All interactive components are keyboard accessible
- Tab order is logical and follows visual layout
- Focus indicators are visible and clear

### Screen Reader Support
- Proper ARIA labels on all components
- Live regions for dynamic content (toasts, status changes)
- Semantic HTML structure

### Color Contrast
- All text meets WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text)
- Color is not the only means of conveying information (icons + text)

### Focus Management
- Dialog components trap focus
- Focus returns to trigger element on close
- Focus visible on all interactive elements

### Testing Checklist

When using components, verify:
- [ ] Keyboard navigation works (Tab, Enter, Escape, Arrow keys)
- [ ] Screen reader announces content correctly
- [ ] Color contrast meets WCAG AA standards
- [ ] Interactive elements have visible focus indicators
- [ ] Form inputs have associated labels
- [ ] Error messages are announced to screen readers
- [ ] Loading states are communicated

## Performance Considerations

### Code Splitting
Components are tree-shakeable. Only import what you need:
```jsx
// Good - only imports what's needed
import { Button } from '@/components/ui/button';

// Avoid - imports entire component library
import * as Components from '@/components';
```

### Memoization
For components with expensive renders:
```jsx
import { memo } from 'react';
import { EnergyCard } from '@/components';

const MemoizedEnergyCard = memo(EnergyCard);
```

### Lazy Loading
For large component sets:
```jsx
import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components';

const ComponentShowcase = lazy(() => import('./ComponentShowcase'));

function App() {
  return (
    <Suspense fallback={<Skeleton className="h-screen" />}>
      <ComponentShowcase />
    </Suspense>
  );
}
```

## Component Reference

See `src/components/ComponentShowcase.jsx` for a live demo of all components with various configurations and use cases.

## Adding New Components

To add a new shadcn/ui component:

```bash
cd web/frontend
npx shadcn@latest add [component-name]
```

Then update `src/components/index.js` to export it:

```javascript
export { NewComponent } from './ui/new-component';
```

For custom components, follow the existing patterns:
1. Create component file in `src/components/`
2. Use TypeScript-style JSDoc comments for props
3. Include usage examples in comments
4. Export from `src/components/index.js`
5. Add to ComponentShowcase for documentation
