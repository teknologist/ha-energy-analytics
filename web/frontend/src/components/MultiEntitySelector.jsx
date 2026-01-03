import { useState } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatEntityName } from '@/lib/utils';

/**
 * Multi-select entity dropdown component
 * @param {Object} props
 * @param {Array} props.entities - Available entities
 * @param {Array} props.selectedIds - Array of selected entity_id strings
 * @param {Function} props.onChange - Callback when selection changes: (selectedIds) => void
 */
export function MultiEntitySelector({ entities, selectedIds = [], onChange }) {
  const [open, setOpen] = useState(false);

  const handleToggle = (entityId) => {
    const newSelection = selectedIds.includes(entityId)
      ? selectedIds.filter((id) => id !== entityId)
      : [...selectedIds, entityId];
    onChange(newSelection);
  };

  const handleSelectAll = () => {
    onChange(entities.map((e) => e.entity_id));
    setOpen(false);
  };

  const handleClearAll = () => {
    onChange([]);
    setOpen(false);
  };

  const handleRemove = (entityId) => {
    onChange(selectedIds.filter((id) => id !== entityId));
  };

  const getEntityName = (entityId) => {
    const entity = entities.find((e) => e.entity_id === entityId);
    return entity?.friendly_name || formatEntityName(entityId);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-[280px] justify-between">
              <span>
                {selectedIds.length === 0
                  ? 'Select entities'
                  : `${selectedIds.length} selected`}
              </span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[280px]" align="start">
            {/* Bulk Actions */}
            <div className="flex gap-1 p-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={handleSelectAll}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={handleClearAll}
              >
                Clear All
              </Button>
            </div>
            <DropdownMenuSeparator />

            {/* Entity List */}
            <div className="max-h-[300px] overflow-y-auto">
              {entities.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">
                  No tracked entities found
                </div>
              ) : (
                entities.map((entity) => {
                  const isSelected = selectedIds.includes(entity.entity_id);
                  return (
                    <DropdownMenuItem
                      key={entity.entity_id}
                      onClick={() => handleToggle(entity.entity_id)}
                      className="flex items-center gap-2"
                    >
                      <div
                        className={`h-4 w-4 rounded border ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'border-input'
                        }`}
                      >
                        {isSelected && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-4 w-4 text-primary-foreground"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                      <span className="flex-1 truncate text-sm">
                        {entity.friendly_name ||
                          formatEntityName(entity.entity_id)}
                      </span>
                    </DropdownMenuItem>
                  );
                })
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Count Indicator */}
        {selectedIds.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {selectedIds.length} of {entities.length} entities
          </span>
        )}
      </div>

      {/* Selected Entity Chips */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedIds.map((entityId) => (
            <Badge key={entityId} variant="secondary" className="gap-1">
              <span className="truncate max-w-[200px]">
                {getEntityName(entityId)}
              </span>
              <button
                onClick={() => handleRemove(entityId)}
                className="ml-1 rounded-full hover:bg-secondary-foreground/20"
                aria-label={`Remove ${entityId}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
