const API_BASE = '/api';
const DEFAULT_TIMEOUT = 30000; // 30 second timeout

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      // Extract endpoint from URL for context
      const endpoint = url.replace(API_BASE, '').split('?')[0];
      throw new Error(
        `API error: ${res.status} ${res.statusText} (${endpoint})`
      );
    }
    return res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      const endpoint = url.replace(API_BASE, '').split('?')[0];
      throw new Error(`Request timeout after ${timeout}ms (${endpoint})`);
    }
    throw error;
  }
}

export async function fetchEntities() {
  try {
    const data = await fetchJson(`${API_BASE}/entities`);
    // Return entities array for backward compatibility, but also include metadata
    const entities = data?.data?.entities || data?.entities || [];
    entities._meta = {
      count: data?.data?.count || entities.length,
      source: data?.data?.source || 'unknown',
      degraded: data?.degraded || false,
    };
    return entities;
  } catch {
    // Fallback to cached entities
    const data = await fetchJson(`${API_BASE}/entities/cached`);
    const entities = data?.data?.entities || data?.entities || [];
    entities._meta = {
      count: data?.data?.count || entities.length,
      source: data?.data?.source || 'database',
      degraded: true,
    };
    return entities;
  }
}

export async function fetchStatistics(entityId, startTime, endTime) {
  const params = new URLSearchParams({
    start_time: startTime,
    end_time: endTime,
  });
  const data = await fetchJson(
    `${API_BASE}/statistics/${encodeURIComponent(entityId)}?${params}`
  );
  return data.data || [];
}

export async function fetchDailySummary(entityId, startTime, endTime) {
  const params = new URLSearchParams({
    start_time: startTime,
    end_time: endTime,
  });
  const data = await fetchJson(
    `${API_BASE}/statistics/${encodeURIComponent(entityId)}/daily?${params}`
  );
  return data.data || [];
}

export async function fetchStatus() {
  return fetchJson(`${API_BASE}/status`);
}

export async function syncData(entityIds, startTime) {
  return fetchJson(`${API_BASE}/statistics/sync`, {
    method: 'POST',
    body: JSON.stringify({
      entity_ids: entityIds,
      start_time: startTime,
      period: 'hour',
    }),
  });
}

export async function updateEntityTracked(entityId, tracked) {
  return fetchJson(`${API_BASE}/entities/${encodeURIComponent(entityId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      is_tracked: tracked,
    }),
  });
}

export async function fetchTopConsumers(period = 'week', limit = 5) {
  const params = new URLSearchParams({ period, limit: limit.toString() });
  const data = await fetchJson(`${API_BASE}/insights/top-consumers?${params}`);
  return data.data || {};
}

export async function fetchPeakConsumption(period = 'week') {
  const params = new URLSearchParams({ period });
  const data = await fetchJson(`${API_BASE}/insights/peak?${params}`);
  return data.data || {};
}

export async function fetchConsumptionPatterns(period = 'week') {
  const params = new URLSearchParams({ period });
  const data = await fetchJson(`${API_BASE}/insights/patterns?${params}`);
  return data.data || {};
}

export async function fetchEntityBreakdown(period = 'week') {
  const params = new URLSearchParams({ period });
  const data = await fetchJson(`${API_BASE}/insights/breakdown?${params}`);
  return data.data || {};
}

export async function fetchConsumptionTimeline(
  period = 'week',
  groupBy = 'hour'
) {
  const params = new URLSearchParams({ period, group_by: groupBy });
  const data = await fetchJson(`${API_BASE}/insights/timeline?${params}`);
  return data.data || {};
}

export async function fetchHeatmapData(period = 'week') {
  const params = new URLSearchParams({ period });
  const data = await fetchJson(`${API_BASE}/insights/heatmap?${params}`);
  return data.data || {};
}
