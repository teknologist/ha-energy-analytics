/**
 * Export statistics data to CSV format
 * @param {Array} data - Array of statistics objects
 * @param {Map} entityMap - Map of entity_id to entity objects
 * @param {string} filename - Output filename
 * @returns {{ success: boolean, error?: string, rowCount?: number }}
 */
export function exportToCsv(data, entityMap, filename) {
  try {
    if (!data || !Array.isArray(data)) {
      return { success: false, error: 'Invalid data: expected array' };
    }

    if (data.length === 0) {
      return { success: false, error: 'No data to export' };
    }

    const headers = [
      'Timestamp',
      'Entity ID',
      'Entity Name',
      'Mean',
      'Min',
      'Max',
      'Sum',
      'Count',
    ];

    const rows = data.map((row) => [
      row.timestamp || row.start_time,
      row.entity_id,
      entityMap.get(row.entity_id)?.friendly_name || row.entity_id,
      row.mean,
      row.min,
      row.max,
      row.sum,
      row.count,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row
          .map((cell) =>
            typeof cell === 'string' && cell.includes(',')
              ? `"${cell}"`
              : (cell ?? '')
          )
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    return { success: true, rowCount: data.length };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to generate CSV' };
  }
}
