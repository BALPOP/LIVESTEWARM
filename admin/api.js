var API_BASE = (window.POPSORTE_CONFIG && window.POPSORTE_CONFIG.API_BASE_URL)
  ? window.POPSORTE_CONFIG.API_BASE_URL
  : 'https://popsorte-staging.danilla-vargas1923.workers.dev';

async function apiFetchJson(path, options = {}) {
  const token = getAuthToken();
  if (!token) throw new Error('Missing admin session');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...options.headers
  };

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `API error ${response.status}`);
  }
  return payload.data ?? payload;
}

function buildPathWithParams(path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    qs.set(key, String(value));
  });
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

async function fetchAllPages(path, { pageSize = 1000, maxRows = 500000 } = {}) {
  const rows = [];
  let offset = 0;

  while (offset < maxRows) {
    const page = await apiFetchJson(buildPathWithParams(path, {
      limit: pageSize,
      offset
    }));

    if (!Array.isArray(page)) {
      return rows;
    }

    for (let i = 0; i < page.length; i++) {
        rows.push(page[i]);
    }
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function fetchPage(path, params = {}) {
  const {
    limit = 1000,
    offset = 0,
    ...restParams
  } = params || {};

  const response = await apiFetchJson(buildPathWithParams(path, {
    limit,
    offset,
    ...restParams
  }));
  return Array.isArray(response) ? { data: response } : response;
}

async function hasRowAtOffset(path, offset, params = {}) {
  const page = await fetchPage(path, { limit: 1, offset, ...params });
  return Array.isArray(page?.data) && page.data.length > 0;
}

async function estimateTotalRows(path, { maxRows = 500000, params = {} } = {}) {
  if (!(await hasRowAtOffset(path, 0, params))) return 0;

  let low = 0;
  let high = 1;

  while (high < maxRows && await hasRowAtOffset(path, high, params)) {
    low = high;
    high = Math.min(high * 2, maxRows);
  }

  let left = low;
  let right = high;
  while (left + 1 < right) {
    const mid = Math.floor((left + right) / 2);
    if (await hasRowAtOffset(path, mid, params)) {
      left = mid;
    } else {
      right = mid;
    }
  }

  return left + 1;
}

async function estimateGroupedStatusTotal(path, statuses = [], { maxRows = 500000 } = {}) {
  const normalized = [...new Set((statuses || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length) return 0;

  const counts = await Promise.all(
    normalized.map(status => estimateTotalRows(path, { maxRows, params: { status } }).catch(() => null))
  );

  const validCounts = counts.filter(value => Number.isFinite(value));
  if (validCounts.length !== normalized.length) return null;
  return validCounts.reduce((sum, value) => sum + value, 0);
}

window.AdminApi = {
  fetchSummary: () => apiFetchJson('/api/admin/summary.json'),
  fetchWinnersFast: ({
    limit = 20000,
    offset = 0,
    contest = '',
    draw_date = '',
    platform = '',
    game_id = '',
    whatsapp = '',
    matches = '',
    contest_window = '',
    status_scope = ''
  } = {}) => fetchPage('/api/admin/winners.json', {
    limit,
    offset,
    contest,
    draw_date,
    platform,
    game_id,
    whatsapp,
    matches,
    contest_window,
    status_scope
  }),
  fetchWinnerProfile: ({ platform = '', gameId = '', whatsapp = '' } = {}) => apiFetchJson(buildPathWithParams('/api/admin/winner-profile.json', {
    platform,
    game_id: gameId,
    whatsapp
  })),
  fetchEntriesPage: ({ limit = 1000, offset = 0, sync = false, sync_keys = 20 } = {}) => fetchPage('/api/admin/entries.json', { limit, offset, sync: sync ? 1 : 0, sync_keys }),
  fetchResultsPage: ({ limit = 1000, offset = 0 } = {}) => fetchPage('/api/admin/results.json', { limit, offset }),
  fetchRechargesPage: ({ limit = 1000, offset = 0 } = {}) => fetchPage('/api/admin/recharge.json', { limit, offset }),
  syncContestStatus: ({ contest = '', draw_date = '', platform = '' } = {}) => apiFetchJson('/api/admin/status/sync-contest', {
    method: 'POST',
    body: JSON.stringify({ contest, draw_date, platform })
  }),
  estimateEntriesTotal: () => estimateTotalRows('/api/admin/entries.json', { maxRows: 500000 }),
  estimateEntriesStatusTotal: (status) => estimateTotalRows('/api/admin/entries.json', { maxRows: 500000, params: { status } }),
  estimateEntriesStatusGroupTotal: (statuses = []) => estimateGroupedStatusTotal('/api/admin/entries.json', statuses, { maxRows: 500000 }),
  estimateResultsTotal: () => estimateTotalRows('/api/admin/results.json', { maxRows: 200000 }),
  estimateRechargesTotal: () => estimateTotalRows('/api/admin/recharge.json', { maxRows: 500000 }),
  fetchEntries: () => fetchAllPages('/api/admin/entries.json'),
  fetchResults: () => fetchAllPages('/api/admin/results.json', { pageSize: 1000, maxRows: 20000 }),
  fetchRecharges: () => fetchAllPages('/api/admin/recharge.json'),
  createResult: (data) => apiFetchJson('/api/admin/results/create', {
    method: 'POST',
    body: JSON.stringify(data)
  })
};
