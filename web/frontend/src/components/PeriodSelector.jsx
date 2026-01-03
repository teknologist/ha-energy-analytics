import { Button } from '@/components/ui/button';

/**
 * Period selector toggle buttons
 * @param {Object} props
 * @param {string} props.value - Current period (day, week, month)
 * @param {Function} props.onChange - Change handler
 */
export function PeriodSelector({ value, onChange }) {
  const periods = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];

  return (
    <div className="flex gap-2">
      {periods.map((period) => (
        <Button
          key={period.value}
          variant={value === period.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(period.value)}
        >
          {period.label}
        </Button>
      ))}
    </div>
  );
}
