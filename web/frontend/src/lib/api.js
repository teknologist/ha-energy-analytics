const API_BASE = '/api';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

export async function fetchEntities() {
  try {
    const data = await fetchJson(`${API_BASE}/entities`);
    return data.entities || [];
  } catch {
    // Fallback to cached entities
    const data = await fetchJson(`${API_BASE}/entities/cached`);
    return data.entities || [];
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
