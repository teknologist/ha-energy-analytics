import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatEntityName } from '@/lib/utils';

export function EntitySelector({ entities, value, onValueChange }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select an entity" />
      </SelectTrigger>
      <SelectContent>
        {entities.map((entity) => (
          <SelectItem key={entity.entity_id} value={entity.entity_id}>
            {entity.friendly_name || formatEntityName(entity.entity_id)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
