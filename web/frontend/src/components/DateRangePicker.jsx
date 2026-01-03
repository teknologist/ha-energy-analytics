import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { format, subDays, subYears } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PRESETS = [
  {
    label: '24 Hours',
    value: '24h',
    getDates: () => ({ start: subDays(new Date(), 1), end: new Date() }),
  },
  {
    label: '7 Days',
    value: '7d',
    getDates: () => ({ start: subDays(new Date(), 7), end: new Date() }),
  },
  {
    label: '30 Days',
    value: '30d',
    getDates: () => ({ start: subDays(new Date(), 30), end: new Date() }),
  },
  {
    label: '90 Days',
    value: '90d',
    getDates: () => ({ start: subDays(new Date(), 90), end: new Date() }),
  },
  {
    label: '1 Year',
    value: '1y',
    getDates: () => ({ start: subYears(new Date(), 1), end: new Date() }),
  },
];

/**
 * DateRangePicker component with quick presets and custom date selection
 * @param {Object} props
 * @param {Date} props.startDate - Start date
 * @param {Date} props.endDate - End date
 * @param {Function} props.onChange - Callback when date range changes: ({ startDate, endDate }) => void
 * @param {number} props.maxRangeDays - Maximum allowed range in days (default: 365)
 */
export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  maxRangeDays = 365,
}) {
  const [selectedPreset, setSelectedPreset] = useState('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [error, setError] = useState('');

  // Initialize custom inputs with current dates
  useEffect(() => {
    if (startDate) setCustomStart(format(startDate, 'yyyy-MM-dd'));
    if (endDate) setCustomEnd(format(endDate, 'yyyy-MM-dd'));
  }, [startDate, endDate]);

  const handlePresetClick = (preset) => {
    setSelectedPreset(preset.value);
    const { start, end } = preset.getDates();
    setError('');
    onChange({ startDate: start, endDate: end });
  };

  const handleCustomDateChange = () => {
    if (!customStart || !customEnd) {
      setError('Both start and end dates are required');
      return;
    }

    const start = new Date(customStart);
    const end = new Date(customEnd);

    // Validation
    if (start > end) {
      setError('Start date must be before end date');
      return;
    }

    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (diffDays > maxRangeDays) {
      setError(`Date range cannot exceed ${maxRangeDays} days`);
      return;
    }

    setError('');
    setSelectedPreset(null); // Clear preset selection
    onChange({ startDate: start, endDate: end });
  };

  return (
    <div className="space-y-4">
      {/* Quick Presets */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.value}
            variant={selectedPreset === preset.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePresetClick(preset)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Custom Date Range */}
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <Input
          type="date"
          value={customStart}
          onChange={(e) => setCustomStart(e.target.value)}
          className="w-[150px]"
          max={format(new Date(), 'yyyy-MM-dd')}
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          value={customEnd}
          onChange={(e) => setCustomEnd(e.target.value)}
          className="w-[150px]"
          max={format(new Date(), 'yyyy-MM-dd')}
        />
        <Button variant="outline" size="sm" onClick={handleCustomDateChange}>
          Apply
        </Button>
      </div>

      {/* Error Message */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Current Range Display */}
      <p className="text-sm text-muted-foreground">
        Selected: {startDate && format(startDate, 'MMM dd, yyyy')} -{' '}
        {endDate && format(endDate, 'MMM dd, yyyy')}
      </p>
    </div>
  );
}
