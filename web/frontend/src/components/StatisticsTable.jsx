import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber, formatDate } from '@/lib/utils';

/**
 * Sortable, paginated statistics table component
 * @param {Object} props
 * @param {Array} props.data - Statistics data
 * @param {Map} props.entityMap - Map of entity_id to entity objects
 * @param {number} props.pageSize - Rows per page (default: 50)
 * @param {number} props.maxDisplayRows - Max rows to display (default: 200)
 */
export function StatisticsTable({
  data = [],
  entityMap = new Map(),
  pageSize = 50,
  maxDisplayRows = 200,
}) {
  const [sortBy, setSortBy] = useState({
    column: 'timestamp',
    direction: 'desc',
  });
  const [currentPage, setCurrentPage] = useState(1);

  // Sort data
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sortBy.column];
      const bVal = b[sortBy.column];
      const dir = sortBy.direction === 'asc' ? 1 : -1;

      if (sortBy.column === 'timestamp') {
        return (
          dir *
          (new Date(aVal || a.start_time) - new Date(bVal || b.start_time))
        );
      }

      if (sortBy.column === 'entity_id') {
        const aName = entityMap.get(aVal)?.friendly_name || aVal;
        const bName = entityMap.get(bVal)?.friendly_name || bVal;
        return dir * aName.localeCompare(bName);
      }

      return dir * ((aVal || 0) - (bVal || 0));
    });
  }, [data, sortBy, entityMap]);

  // Paginate data (only show first maxDisplayRows)
  const displayData = sortedData.slice(0, maxDisplayRows);
  const paginatedData = displayData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const totalPages = Math.ceil(displayData.length / pageSize);

  // Handle sort column click
  const handleSort = (column) => {
    setSortBy((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
    setCurrentPage(1); // Reset to first page on sort
  };

  // Render sort icon
  const SortIcon = ({ column }) => {
    if (sortBy.column !== column) return null;
    return sortBy.direction === 'asc' ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    );
  };

  if (data.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        No data available for the selected period
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="rounded-md border">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur">
              <tr className="border-b">
                <th
                  className="py-3 px-4 text-left font-medium cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => handleSort('timestamp')}
                >
                  <div className="flex items-center gap-1">
                    Timestamp
                    <SortIcon column="timestamp" />
                  </div>
                </th>
                <th
                  className="py-3 px-4 text-left font-medium cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => handleSort('entity_id')}
                >
                  <div className="flex items-center gap-1">
                    Entity
                    <SortIcon column="entity_id" />
                  </div>
                </th>
                <th
                  className="py-3 px-4 text-right font-medium cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => handleSort('mean')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Mean
                    <SortIcon column="mean" />
                  </div>
                </th>
                <th
                  className="py-3 px-4 text-right font-medium cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => handleSort('min')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Min
                    <SortIcon column="min" />
                  </div>
                </th>
                <th
                  className="py-3 px-4 text-right font-medium cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => handleSort('max')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Max
                    <SortIcon column="max" />
                  </div>
                </th>
                <th
                  className="py-3 px-4 text-right font-medium cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => handleSort('sum')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Sum
                    <SortIcon column="sum" />
                  </div>
                </th>
                <th
                  className="py-3 px-4 text-right font-medium cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => handleSort('count')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Count
                    <SortIcon column="count" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((row, idx) => (
                <tr
                  key={`${row.entity_id}-${row.timestamp || row.start_time}-${idx}`}
                  className="border-b border-border/50 hover:bg-muted/30"
                >
                  <td className="py-2 px-4 text-muted-foreground">
                    {formatDate(row.timestamp || row.start_time)}
                  </td>
                  <td className="py-2 px-4 truncate max-w-[200px]">
                    {entityMap.get(row.entity_id)?.friendly_name ||
                      row.entity_id}
                  </td>
                  <td className="py-2 px-4 text-right">
                    {formatNumber(row.mean)} kWh
                  </td>
                  <td className="py-2 px-4 text-right text-muted-foreground">
                    {formatNumber(row.min)}
                  </td>
                  <td className="py-2 px-4 text-right text-muted-foreground">
                    {formatNumber(row.max)}
                  </td>
                  <td className="py-2 px-4 text-right font-medium">
                    {formatNumber(row.sum)}
                  </td>
                  <td className="py-2 px-4 text-right text-muted-foreground">
                    {row.count || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {(currentPage - 1) * pageSize + 1} to{' '}
          {Math.min(currentPage * pageSize, displayData.length)} of{' '}
          {displayData.length} rows
          {data.length > maxDisplayRows && (
            <span className="ml-2 text-amber-600 dark:text-amber-500">
              (Limited to first {maxDisplayRows} rows - export CSV for full
              dataset)
            </span>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
