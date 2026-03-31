const state = {
  entries: [],
  results: [],
  recharges: [],
  validatedEntries: [],
  winners: [],
  autoWinners: [],
  manualWinners: [],
  winnerMode: 'auto',
  lastRefresh: null,
  sort: { key: 'registrationDateTime', dir: 'desc' },
  chartInstance: null,
  entriesPaging: {
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1
  },
  incremental: {
    runId: 0,
    pageSize: 5000,
    entries: { offset: 0, done: false, loading: false },
    results: { offset: 0, done: false, loading: false },
    recharges: { offset: 0, done: false, loading: false },
    winnersBackfill: false,
    winnersFastLoaded: false,
    winnersFastError: null,
    totals: { entries: null, results: null, recharges: null },
    summary: {
      valid: null,
      invalid: null,
      pending: null,
      unknown: null,
      uniqueContests: null,
      uniqueDrawDates: null
    }
  },
  dashboardPaging: {
    recent: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    daily: { page: 1, pageSize: 7, total: 0, totalPages: 1 }
  }
};

const rechargeValidator = new RechargeValidator();
const lotteryValidator = new LotteryValidator();
let loadAllDataPromise = null;
let backgroundWarmupPromise = null;

function normalizeEntries(rows) {
  return (rows || []).map(row => {
    const createdAt = AdminUtils.parseISO(row.created_at);
    const drawDate = row.draw_date ? String(row.draw_date) : '';
    const numbers = Array.isArray(row.numbers) ? row.numbers.map(n => Number(n)).filter(n => !Number.isNaN(n)) : [];

    return {
      createdAtRaw: row.created_at,
      registrationDateTime: createdAt ? AdminUtils.formatBrtDateTime(createdAt) : '',
      registrationDate: createdAt ? AdminUtils.formatBrtDate(createdAt) : '',
      registrationTime: createdAt ? AdminUtils.formatBrtTime(createdAt) : '',
      platform: row.platform || 'UNKNOWN',
      gameId: row.game_id || '',
      whatsapp: row.whatsapp || '',
      chosenNumbers: numbers,
      drawDate: drawDate,
      displayDrawDate: AdminUtils.formatYMD(drawDate),
      contest: row.contest || '',
      ticketNumber: row.ticket_number || '',
      status: row.status || '',
      csvStatus: row.status || '',
      boundRechargeIdRaw: row.bound_recharge_id || null,
      syncReasonRaw: row.sync_reason || null
    };
  });
}

function normalizeResults(rows) {
  return (rows || []).map(row => ({
    contest: row.contest || '',
    drawDate: row.draw_date ? String(row.draw_date) : '',
    displayDrawDate: AdminUtils.formatYMD(row.draw_date),
    winningNumbers: [row.num1, row.num2, row.num3, row.num4, row.num5].map(n => Number(n)).filter(n => !Number.isNaN(n)),
    createdAt: row.created_at || ''
  }));
}

function normalizeRecharges(rows) {
  return (rows || []).map(row => {
    const recordTime = AdminUtils.parseISO(row.record_time);
    return {
      platform: row.platform || 'UNKNOWN',
      memberId: row.member_id || '',
      gameId: row.member_id || '',
      rechargeId: row.order_number || '',
      orderNumber: row.order_number || '',
      rechargeTime: recordTime ? AdminUtils.formatBrtDateTime(recordTime) : '',
      rechargeTimeObj: recordTime,
      rechargeAmount: Number(row.change_amount) || 0,
      balanceAfter: Number(row.balance_after) || 0,
      rechargeStatus: 'VALID'
    };
  });
}

function loadAllData() {
  if (loadAllDataPromise) return loadAllDataPromise;

  const currentLoad = (async () => {
    setStatus('Loading...');
    setLoading(true);
    const runId = state.incremental.runId + 1;
    state.incremental.runId = runId;
    state.incremental.winnersFastLoaded = false;
    state.incremental.winnersFastError = null;
    try {
      const pageSize = state.incremental.pageSize;
      const entriesPagePromise = AdminApi.fetchEntriesPage({ limit: pageSize, offset: 0, sync: true, sync_keys: 20 })
        .catch(async (syncErr) => {
          console.warn('Initial sync-on-load failed, fallback to non-sync entries fetch:', syncErr);
          return AdminApi.fetchEntriesPage({ limit: pageSize, offset: 0, sync: false });
        });

      const [summaryRaw, entriesPage, resultsPage, rechargesPage] = await Promise.all([
        AdminApi.fetchSummary().catch(() => null),
        entriesPagePromise,
        AdminApi.fetchResultsPage({ limit: pageSize, offset: 0 }),
        AdminApi.fetchRechargesPage({ limit: pageSize, offset: 0 })
      ]);

      const entriesRaw = Array.isArray(entriesPage?.data) ? entriesPage.data : [];
      const resultsRaw = Array.isArray(resultsPage?.data) ? resultsPage.data : [];
      const rechargesRaw = Array.isArray(rechargesPage?.data) ? rechargesPage.data : [];

      state.incremental.totals.entries = Number.isFinite(Number(summaryRaw?.totalEntries))
        ? Number(summaryRaw.totalEntries)
        : null;
      state.incremental.totals.results = Number.isFinite(Number(summaryRaw?.totalResults))
        ? Number(summaryRaw.totalResults)
        : null;
      state.incremental.totals.recharges = Number.isFinite(Number(summaryRaw?.totalRecharges))
        ? Number(summaryRaw.totalRecharges)
        : null;
      state.incremental.summary.valid = Number.isFinite(Number(summaryRaw?.totalValid))
        ? Number(summaryRaw.totalValid)
        : null;
      state.incremental.summary.invalid = Number.isFinite(Number(summaryRaw?.totalInvalid))
        ? Number(summaryRaw.totalInvalid)
        : null;
      state.incremental.summary.pending = Number.isFinite(Number(summaryRaw?.totalPending))
        ? Number(summaryRaw.totalPending)
        : null;
      state.incremental.summary.unknown = Number.isFinite(Number(summaryRaw?.totalUnknown))
        ? Number(summaryRaw.totalUnknown)
        : null;
      state.incremental.summary.uniqueContests = Number.isFinite(Number(summaryRaw?.uniqueContests))
        ? Number(summaryRaw.uniqueContests)
        : null;
      state.incremental.summary.uniqueDrawDates = Number.isFinite(Number(summaryRaw?.uniqueDrawDates))
        ? Number(summaryRaw.uniqueDrawDates)
        : null;

      state.entries = normalizeEntries(entriesRaw);
      state.results = normalizeResults(resultsRaw);
      state.recharges = normalizeRecharges(rechargesRaw);

      state.incremental.entries = {
        offset: state.entries.length,
        done: entriesRaw.length < pageSize,
        loading: false
      };
      state.incremental.results = {
        offset: state.results.length,
        done: resultsRaw.length < pageSize,
        loading: false
      };
      state.incremental.recharges = {
        offset: state.recharges.length,
        done: rechargesRaw.length < pageSize,
        loading: false
      };

      recomputeDerivedData();

      state.lastRefresh = new Date();
      renderAll();
      if (summaryRaw) {
        setStatus(getInitialLoadStatus());
      } else {
        setStatus('Updated (partial view: summary unavailable)');
      }

      startBackgroundWarmup(runId).catch(err => {
        console.warn('Background warm-up failed:', err);
      });
    } catch (err) {
      setStatus('Error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  })();

  loadAllDataPromise = currentLoad;
  currentLoad.finally(() => {
    if (loadAllDataPromise === currentLoad) {
      loadAllDataPromise = null;
    }
  });

  return currentLoad;
}

async function startBackgroundWarmup(runId) {
  if (backgroundWarmupPromise) return backgroundWarmupPromise;

  const runner = (async () => {
    let iteration = 0;
    while (runId === state.incremental.runId && (!state.incremental.entries.done || !state.incremental.recharges.done)) {
      const tasks = [];
      if (!state.incremental.entries.done) tasks.push(fetchNextDatasetPage('entries', runId));
      if (!state.incremental.recharges.done) tasks.push(fetchNextDatasetPage('recharges', runId));
      if (!tasks.length) break;

      const counts = await Promise.all(tasks);
      const changed = counts.some(count => count > 0);
      if (!changed) break;

      iteration += 1;
      if (iteration % 2 === 0) {
        recomputeDerivedData();
        renderDashboard();
        renderEntries();
        updateFilters();
      }

      setStatus(getInitialLoadStatus());

      if (iteration % 4 === 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    if (runId === state.incremental.runId) {
      recomputeDerivedData();
      renderAll();
      setStatus(getInitialLoadStatus());
    }
  })();

  backgroundWarmupPromise = runner;
  try {
    await runner;
  } finally {
    if (backgroundWarmupPromise === runner) {
      backgroundWarmupPromise = null;
    }
  }
}

function recomputeDerivedData() {
  rechargeValidator.setRecharges(state.recharges, {
    isComplete: !!state.incremental.recharges.done
  });
  state.validatedEntries = rechargeValidator.validateEntries(state.entries);

  lotteryValidator.setResults(state.results);
  state.manualWinners = lotteryValidator.getApprovedWinners(state.validatedEntries);
  const autoEntries = state.validatedEntries
    .filter(entry => entry.validity === 'VALID')
    .map(entry => ({ ...entry, status: 'VALID' }));
  state.autoWinners = lotteryValidator.getWinners(autoEntries);
  state.winners = state.winnerMode === 'manual' ? state.manualWinners : state.autoWinners;
}

function isIncrementalDone() {
  return state.incremental.entries.done && state.incremental.results.done && state.incremental.recharges.done;
}

function getIncrementalStatus() {
  if (isIncrementalDone()) return 'Updated (all data loaded)';
  const fmt = (value, done) => `${value}${done ? '' : '+'}`;
  return `Loading older data... entries ${fmt(state.entries.length, state.incremental.entries.done)}, results ${fmt(state.results.length, state.incremental.results.done)}, recharges ${fmt(state.recharges.length, state.incremental.recharges.done)}`;
}

function getWinnersLoadStatus() {
  const fmt = (value, done) => `${value}${done ? '' : '+'}`;
  return `Loading winners data... entries ${fmt(state.entries.length, state.incremental.entries.done)}, results ${fmt(state.results.length, state.incremental.results.done)}, recharges ${fmt(state.recharges.length, state.incremental.recharges.done)}`;
}

function getInitialLoadStatus() {
  if (isIncrementalDone()) return 'Updated (all data loaded)';
  const { entries, results, recharges } = state.incremental.totals;
  const fmt = (loaded, total) => Number.isFinite(total) ? `${loaded}/${total}` : `${loaded}+`;
  return `Updated (latest loaded: entries ${fmt(state.entries.length, entries)}, results ${fmt(state.results.length, results)}, recharges ${fmt(state.recharges.length, recharges)}; older data loads when paging)`;
}

async function resolveMissingTotals(runId) {
  if (runId !== state.incremental.runId) return;

  const needsEntries = !Number.isFinite(state.incremental.totals.entries);
  const needsResults = !Number.isFinite(state.incremental.totals.results);
  const needsRecharges = !Number.isFinite(state.incremental.totals.recharges);
  const needsValid = !Number.isFinite(state.incremental.summary.valid);
  const needsInvalid = !Number.isFinite(state.incremental.summary.invalid);
  const needsPending = !Number.isFinite(state.incremental.summary.pending);
  const needsUnknown = !Number.isFinite(state.incremental.summary.unknown);
  if (!needsEntries && !needsResults && !needsRecharges && !needsValid && !needsInvalid && !needsPending && !needsUnknown) return;

  setStatus('Detecting total rows (no full fetch)...');

  const tasks = [
    needsEntries ? AdminApi.estimateEntriesTotal().catch(() => null) : Promise.resolve(null),
    needsResults ? AdminApi.estimateResultsTotal().catch(() => null) : Promise.resolve(null),
    needsRecharges ? AdminApi.estimateRechargesTotal().catch(() => null) : Promise.resolve(null),
    needsValid
      ? AdminApi.estimateEntriesStatusGroupTotal(['VALID', 'VALIDADO', 'VALIDATED', 'VALIDO', 'VÁLIDO']).catch(() => null)
      : Promise.resolve(null),
    needsInvalid
      ? AdminApi.estimateEntriesStatusGroupTotal(['INVALID', 'INVÁLIDO', 'REJECTED', 'CANCELLED']).catch(() => null)
      : Promise.resolve(null),
    needsPending ? AdminApi.estimateEntriesStatusTotal('PENDING').catch(() => null) : Promise.resolve(null)
  ];

  const [entriesTotal, resultsTotal, rechargesTotal, validTotal, invalidTotal, pendingTotal] = await Promise.all(tasks);
  if (runId !== state.incremental.runId) return;

  if (Number.isFinite(entriesTotal)) state.incremental.totals.entries = Number(entriesTotal);
  if (Number.isFinite(resultsTotal)) state.incremental.totals.results = Number(resultsTotal);
  if (Number.isFinite(rechargesTotal)) state.incremental.totals.recharges = Number(rechargesTotal);
  if (Number.isFinite(validTotal)) state.incremental.summary.valid = Number(validTotal);
  if (Number.isFinite(invalidTotal)) state.incremental.summary.invalid = Number(invalidTotal);
  if (Number.isFinite(pendingTotal)) state.incremental.summary.pending = Number(pendingTotal);

  const currentEntriesTotal = Number(state.incremental.totals.entries);
  const currentValid = Number(state.incremental.summary.valid);
  const currentInvalid = Number(state.incremental.summary.invalid);
  const currentPending = Number(state.incremental.summary.pending);
  if (Number.isFinite(currentEntriesTotal) && Number.isFinite(currentValid) && Number.isFinite(currentInvalid) && Number.isFinite(currentPending) && needsUnknown) {
    state.incremental.summary.unknown = Math.max(currentEntriesTotal - currentValid - currentInvalid - currentPending, 0);
  }

  renderDashboard();
  renderEntriesPagination();
  setStatus(getInitialLoadStatus());
}

async function fetchNextDatasetPage(type, runId) {
  if (runId !== state.incremental.runId) return 0;

  const tracker = state.incremental[type];
  if (!tracker || tracker.done || tracker.loading) return 0;

  tracker.loading = true;
  try {
    const limit = state.incremental.pageSize;
    const offset = tracker.offset;

    let rows = [];
    if (type === 'entries') {
      const page = await AdminApi.fetchEntriesPage({ limit, offset });
      rows = Array.isArray(page?.data) ? page.data : [];
      const normalizedEntries = normalizeEntries(rows);
      for (let i = 0; i < normalizedEntries.length; i++) {
          state.entries.push(normalizedEntries[i]);
      }
    } else if (type === 'results') {
      const page = await AdminApi.fetchResultsPage({ limit, offset });
      rows = Array.isArray(page?.data) ? page.data : [];
      const normalizedResults = normalizeResults(rows);
      for (let i = 0; i < normalizedResults.length; i++) {
          state.results.push(normalizedResults[i]);
      }
    } else if (type === 'recharges') {
      const page = await AdminApi.fetchRechargesPage({ limit, offset });
      rows = Array.isArray(page?.data) ? page.data : [];
      const normalizedRecharges = normalizeRecharges(rows);
      for (let i = 0; i < normalizedRecharges.length; i++) {
          state.recharges.push(normalizedRecharges[i]);
      }
    }

    tracker.offset += rows.length;
    if (rows.length < limit) tracker.done = true;
    return rows.length;
  } finally {
    tracker.loading = false;
  }
}

async function fetchEntriesUntilPage(targetPage) {
  const targetRows = Math.max(1, targetPage) * state.entriesPaging.pageSize;
  const runId = state.incremental.runId;
  let changed = false;

  while (runId === state.incremental.runId && state.entries.length < targetRows && !state.incremental.entries.done) {
    const [entryRows, rechargeRows] = await Promise.all([
      fetchNextDatasetPage('entries', runId),
      fetchNextDatasetPage('recharges', runId)
    ]);

    if (entryRows > 0 || rechargeRows > 0) {
      changed = true;
    } else {
      break;
    }

    setStatus(getIncrementalStatus());
  }

  if (changed) {
    recomputeDerivedData();
    renderAll();
    setStatus(getIncrementalStatus());
  }
}

async function ensureWinnersDataReady() {
  if (state.incremental.winnersBackfill) return;

  if (!state.incremental.winnersFastLoaded) {
    try {
      state.incremental.winnersBackfill = true;
      setStatus('Loading winners data (fast path)...');

      const page = await AdminApi.fetchWinnersFast({ limit: 5000, offset: 0, contest_window: 2, status_scope: 'valid' });
      const rows = Array.isArray(page?.data) ? page.data : [];
      const mapped = rows.map(mapFastWinnerRow);

      state.autoWinners = mapped;
      if (state.winnerMode === 'auto') {
        state.winners = mapped;
      }
      state.incremental.winnersFastLoaded = true;
      state.incremental.winnersFastError = null;

      renderWinners();
      updateFilters();
      setStatus(getInitialLoadStatus());
      return;
    } catch (err) {
      console.warn('Fast winners fetch failed, fallback to historical backfill:', err);
      state.incremental.winnersFastError = err?.message || 'Fast winners endpoint failed';
      renderWinners();
      setStatus('Winners fast endpoint unavailable. Try refresh after worker deploy.');
      return;
    } finally {
      state.incremental.winnersBackfill = false;
    }
  }
}

function mapFastWinnerRow(row) {
  return {
    platform: row.platform || '',
    gameId: row.game_id || '',
    whatsapp: row.whatsapp || '',
    contest: row.contest || '',
    drawDate: row.draw_date || '',
    chosenNumbers: Array.isArray(row.chosen_numbers) ? row.chosen_numbers : [],
    status: row.status || 'VALID',
    validation: {
      validated: true,
      matches: Number(row.matches) || 0,
      matchedNumbers: Array.isArray(row.matched_numbers) ? row.matched_numbers : [],
      winningNumbers: Array.isArray(row.winning_numbers) ? row.winning_numbers : [],
      prizeTier: {
        tier: row.prize_tier || 'NO PRIZE'
      }
    }
  };
}

function resolveWinnerTierToMatches(tier) {
  const value = String(tier || '').trim().toUpperCase();
  if (value === 'JACKPOT') return 5;
  if (value === '4 NUMBERS') return 4;
  if (value === '3 NUMBERS') return 3;
  if (value === '2 NUMBERS') return 2;
  if (value === '1 NUMBER') return 1;
  return '';
}

async function loadWinnersByCurrentFilters() {
  if (state.incremental.winnersBackfill) return;

  const contest = getFilter('filterWinnerContest');
  const drawDate = getFilter('filterWinnerDrawDate');
  const platform = getFilter('filterWinnerPlatform');
  const tier = getFilter('filterWinnerTier');
  const whatsappRaw = (document.getElementById('filterWinnerWhatsapp')?.value || '').trim();

  const params = {
    limit: 5000,
    offset: 0,
    contest: contest && contest !== 'ALL' ? contest : '',
    draw_date: drawDate && drawDate !== 'ALL' ? drawDate : '',
    platform: platform && platform !== 'ALL' ? platform : '',
    whatsapp: whatsappRaw || '',
    matches: resolveWinnerTierToMatches(tier),
    contest_window: 2,
    status_scope: 'valid'
  };

  if (params.contest) {
    params.contest_window = 1;
  } else if (params.draw_date) {
    params.contest_window = 2;
  } else if (params.platform || params.whatsapp || params.matches !== '') {
    params.contest_window = 6;
  }

  state.incremental.winnersBackfill = true;
  setStatus('Loading winners by filter...');
  try {
    const page = await AdminApi.fetchWinnersFast(params);
    const rows = Array.isArray(page?.data) ? page.data : [];
    const mapped = rows.map(mapFastWinnerRow);

    state.autoWinners = mapped;
    if (state.winnerMode === 'auto') {
      state.winners = mapped;
    }
    state.incremental.winnersFastLoaded = true;
    state.incremental.winnersFastError = null;

    renderWinners();
    updateFilters();
    setStatus(getInitialLoadStatus());
  } catch (err) {
    state.incremental.winnersFastError = err?.message || 'Failed to load winners by filter';
    renderWinners();
    setStatus('Winners fetch failed. Check filters or worker logs.');
  } finally {
    state.incremental.winnersBackfill = false;
  }
}

async function syncCurrentWinnerContest() {
  setStatus('Auto-sync is active. Refreshing winners with latest synced entries...');
  return true;
}

function isPageActive(pageName) {
  const page = document.getElementById(`page-${pageName}`);
  return !!page && page.classList.contains('active');
}

function renderAll() {
  renderDashboard();
  renderEntries();
  renderResults();
  renderRecharges();
  renderWinners();
  updateFilters();
}

function renderDashboard() {
  const stats = rechargeValidator.getStatistics();
  const hasFullDerived = state.incremental.entries.done && state.incremental.recharges.done && state.incremental.results.done;
  const hasParticipationComplete = state.incremental.entries.done && state.incremental.recharges.done;
  const totalEntries = state.incremental.totals.entries;
  const totalResults = state.incremental.totals.results;
  const totalRecharges = state.incremental.totals.recharges;
  const totalValid = state.incremental.summary.valid;
  const totalInvalid = state.incremental.summary.invalid;
  const totalUnknown = state.incremental.summary.unknown;
  const uniqueContests = state.incremental.summary.uniqueContests;
  const uniqueDrawDates = state.incremental.summary.uniqueDrawDates;

  setText('kpiTotalEntries', Number.isFinite(totalEntries) ? totalEntries : state.entries.length);
  setText('kpiValidTickets', Number.isFinite(totalValid) ? totalValid : stats.validTickets);
  setText('kpiInvalidTickets', Number.isFinite(totalInvalid) ? totalInvalid : stats.invalidTickets);
  setText('kpiUnknownTickets', Number.isFinite(totalUnknown) ? totalUnknown : stats.unknownTickets);
  setText('kpiCutoffShift', hasFullDerived ? stats.cutoffShiftCases : '...');
  setText('kpiAutoWinners', hasFullDerived ? state.autoWinners.length : '...');
  setText('kpiManualWinners', hasFullDerived ? state.manualWinners.length : '...');
  setText('kpiTotalRecharges', Number.isFinite(totalRecharges) ? totalRecharges : stats.totalRecharges);
  setText('kpiTotalResults', Number.isFinite(totalResults) ? totalResults : state.results.length);
  setText('kpiUniqueContests', Number.isFinite(uniqueContests) ? uniqueContests : (hasFullDerived ? new Set(state.entries.map(e => e.contest).filter(Boolean)).size : '...'));
  setText('kpiUniqueDrawDates', Number.isFinite(uniqueDrawDates) ? uniqueDrawDates : (hasFullDerived ? new Set(state.entries.map(e => e.drawDate).filter(Boolean)).size : '...'));

  const breakdown = document.getElementById('validationBreakdown');
  breakdown.innerHTML = '';
  Object.entries(stats.invalidReasons || {}).forEach(([code, count]) => {
    const item = document.createElement('div');
    item.textContent = `${code}: ${count}`;
    breakdown.appendChild(item);
  });

  const snapshot = document.getElementById('participationSnapshot');
  snapshot.innerHTML = '';
  const rechargeKeys = new Set(state.recharges.map(r => `${r.platform}_${r.gameId}`));
  const ticketKeys = new Set(state.validatedEntries.map(e => `${e.platform}_${e.gameId}`));
  const rechargedNoTicket = [...rechargeKeys].filter(key => !ticketKeys.has(key));
  const participated = rechargeKeys.size - rechargedNoTicket.length;
  const prefix = hasParticipationComplete ? '' : '~ ';
  const suffix = hasParticipationComplete ? '' : ' (loaded subset)';
  snapshot.innerHTML = `
    <div>Total Rechargers: ${prefix}${rechargeKeys.size}${suffix}</div>
    <div>Participants: ${prefix}${participated}${suffix}</div>
    <div>No Ticket: ${prefix}${rechargedNoTicket.length}${suffix}</div>
  `;

  renderPlatformBreakdown(hasParticipationComplete);
  renderLatestResults();
  renderRecentEntries();
  renderEntriesTrend();
  renderDailyParticipation();
  renderContestCompare();
  renderWinningNumbersTrend();
  renderContestWinnersBreakdown();
  renderPlayerBehavior();

  renderAnomalies();
}

function renderPlatformBreakdown(isComplete = false) {
  const container = document.getElementById('platformBreakdown');
  if (!container) return;
  container.innerHTML = '';

  const platforms = ['POPLUZ', 'POPN1'];
  platforms.forEach(platform => {
    const total = state.entries.filter(e => e.platform === platform).length;
    const valid = state.validatedEntries.filter(e => e.platform === platform && e.validity === 'VALID').length;
    const ratio = total > 0 ? ((valid / total) * 100).toFixed(1) : '0.0';
    const item = document.createElement('div');
    const prefix = isComplete ? '' : '~ ';
    const suffix = isComplete ? '' : ' (loaded subset)';
    item.textContent = `${platform}: ${prefix}${total} entries | ${prefix}${valid} valid (${ratio}%)${suffix}`;
    container.appendChild(item);
  });
}

function renderLatestResults() {
  const tbody = document.getElementById('latestResultsTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  const latest = [...state.results].slice(0, 5);
  latest.forEach(result => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${result.contest}</td>
      <td>${result.displayDrawDate || result.drawDate}</td>
      <td>${result.winningNumbers.map(n => String(n).padStart(2, '0')).join(', ')}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderRecentEntries() {
  const tbody = document.getElementById('recentEntriesTable');
  if (!tbody) return;
  tbody.innerHTML = '';

  const sorted = [...state.validatedEntries].sort((a, b) => (b.createdAtRaw || '').localeCompare(a.createdAtRaw || ''));
  const paging = state.dashboardPaging.recent;
  paging.total = sorted.length;
  paging.totalPages = Math.max(1, Math.ceil(paging.total / paging.pageSize));
  if (paging.page > paging.totalPages) paging.page = paging.totalPages;

  const start = (paging.page - 1) * paging.pageSize;
  const list = sorted.slice(start, start + paging.pageSize);

  list.forEach(entry => {
    const platformHtml = formatPlatformBadge(entry.platform);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${entry.registrationDateTime}</td>
      <td>${platformHtml}</td>
      <td>${entry.gameId}</td>
      <td>${entry.whatsapp}</td>
      <td>${entry.chosenNumbers.join(', ')}</td>
      <td>${entry.displayDrawDate || entry.drawDate}</td>
      <td>${entry.contest}</td>
      <td>${entry.validity}</td>
    `;
    tbody.appendChild(tr);
  });

  renderDashboardPager('recent');
}

function renderEntriesTrend() {
  const metric = document.getElementById('chartMetricSelect')?.value || 'entries';
  const byDate = {};

  const init = (key) => {
    if (!byDate[key]) {
      byDate[key] = { entries: 0, rechargers: new Set(), participants: new Set(), noTicket: 0 };
    }
  };

  state.validatedEntries.forEach(entry => {
    const key = dateKeyFromDate(entry.ticketTimeObj || AdminUtils.parseISO(entry.createdAtRaw));
    if (!key) return;
    init(key);
    byDate[key].entries += 1;
    byDate[key].participants.add(`${entry.platform}_${entry.gameId}`);
  });

  state.recharges.forEach(recharge => {
    const key = dateKeyFromDate(recharge.rechargeTimeObj);
    if (!key) return;
    init(key);
    byDate[key].rechargers.add(`${recharge.platform}_${recharge.gameId}`);
  });

  Object.values(byDate).forEach(bucket => {
    let count = 0;
    bucket.rechargers.forEach(key => {
      if (!bucket.participants.has(key)) count += 1;
    });
    bucket.noTicket = count;
  });

  const allDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const last7 = allDates.slice(0, 7).reverse();
  const labels = last7.map(d => d.split('-').slice(1).reverse().join('/'));
  const values = last7.map(d => {
    const bucket = byDate[d];
    if (!bucket) return 0;
    if (metric === 'rechargers') return bucket.rechargers.size;
    if (metric === 'participants') return bucket.participants.size;
    if (metric === 'noTicket') return bucket.noTicket;
    return bucket.entries;
  });

  const ctx = document.getElementById('dashboardChart');
  if (!ctx) return;

  if (state.chartInstance) state.chartInstance.destroy();
  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: metric,
          data: values,
          borderColor: '#1d4ed8',
          backgroundColor: 'rgba(29, 78, 216, 0.2)',
          pointRadius: 4,
          pointBackgroundColor: '#ffffff',
          borderWidth: 3,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderDailyParticipation() {
  const tbody = document.getElementById('dailyParticipationBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const byDate = {};
  const init = (key) => {
    if (!byDate[key]) {
      byDate[key] = { rechargers: new Set(), participants: new Set(), tickets: 0 };
    }
  };

  state.recharges.forEach(recharge => {
    const key = dateKeyFromDate(recharge.rechargeTimeObj);
    if (!key) return;
    init(key);
    byDate[key].rechargers.add(`${recharge.platform}_${recharge.gameId}`);
  });

  state.validatedEntries.forEach(entry => {
    const key = dateKeyFromDate(entry.ticketTimeObj || AdminUtils.parseISO(entry.createdAtRaw));
    if (!key) return;
    init(key);
    byDate[key].participants.add(`${entry.platform}_${entry.gameId}`);
    byDate[key].tickets += 1;
  });

  const sortedDays = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const paging = state.dashboardPaging.daily;
  paging.total = sortedDays.length;
  paging.totalPages = Math.max(1, Math.ceil(paging.total / paging.pageSize));
  if (paging.page > paging.totalPages) paging.page = paging.totalPages;

  const start = (paging.page - 1) * paging.pageSize;
  const days = sortedDays.slice(start, start + paging.pageSize);

  days.forEach(date => {
    const record = byDate[date];
    const rechargers = record.rechargers.size;
    const participants = record.participants.size;
    const noTicket = Math.max(rechargers - participants, 0);
    const participation = rechargers > 0 ? ((participants / rechargers) * 100).toFixed(2) : '0.00';
    const nonParticipation = rechargers > 0 ? (100 - parseFloat(participation)).toFixed(2) : '0.00';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${date}</td>
      <td>${rechargers}</td>
      <td>${participants}</td>
      <td>${noTicket}</td>
      <td>${participation}%</td>
      <td>${nonParticipation}%</td>
      <td>${record.tickets}</td>
    `;
    tbody.appendChild(tr);
  });

  renderDashboardPager('daily');
}

function renderDashboardPager(type) {
  const config = {
    recent: {
      infoId: 'recentPageInfo',
      prevId: 'recentPrevPage',
      nextId: 'recentNextPage',
      sizeId: 'recentPageSize',
      label: 'entries'
    },
    daily: {
      infoId: 'dailyPageInfo',
      prevId: 'dailyPrevPage',
      nextId: 'dailyNextPage',
      sizeId: 'dailyPageSize',
      label: 'days'
    }
  }[type];

  if (!config) return;

  const info = document.getElementById(config.infoId);
  const prev = document.getElementById(config.prevId);
  const next = document.getElementById(config.nextId);
  const size = document.getElementById(config.sizeId);
  const paging = state.dashboardPaging[type];
  if (!info || !prev || !next || !size || !paging) return;

  info.textContent = `Page ${paging.page} of ${paging.totalPages} (${paging.total} ${config.label})`;
  prev.disabled = paging.page <= 1;
  next.disabled = paging.page >= paging.totalPages;
  if (String(size.value) !== String(paging.pageSize)) size.value = String(paging.pageSize);
}

function renderContestCompare() {
  const platformFilter = document.getElementById('contestPlatformFilter')?.value || '';
  const entries = state.validatedEntries.filter(entry =>
    !platformFilter || entry.platform === platformFilter
  );
  const contests = Array.from(new Set(entries.map(e => e.contest).filter(Boolean)))
    .sort((a, b) => Number(b) - Number(a));

  const current = contests[0];
  const previous = contests[1];

  renderContestRanking(entries, current, {
    contestId: 'currentContestNumber',
    entriesId: 'currentContestEntries',
    picksId: 'currentContestPicks',
    tbodyId: 'currentContestNumberStatsBody'
  });

  renderContestRanking(entries, previous, {
    contestId: 'previousContestNumber',
    entriesId: 'previousContestEntries',
    picksId: 'previousContestPicks',
    tbodyId: 'previousContestNumberStatsBody'
  });
}

function renderContestRanking(entries, contestValue, options) {
  const tbody = document.getElementById(options.tbodyId);
  if (!tbody) return;

  if (!contestValue) {
    setText(options.contestId, '—');
    setText(options.entriesId, 0);
    setText(options.picksId, 0);
    tbody.innerHTML = '<tr><td colspan="4" class="muted">No contest data</td></tr>';
    return;
  }

  const contestEntries = entries.filter(e => String(e.contest) === String(contestValue));
  const frequency = Array.from({ length: 80 }, () => 0);
  contestEntries.forEach(entry => {
    entry.chosenNumbers.forEach(num => {
      if (num >= 1 && num <= 80) frequency[num - 1] += 1;
    });
  });

  const ranking = frequency.map((count, idx) => ({ number: idx + 1, count }))
    .sort((a, b) => b.count - a.count || a.number - b.number);
  const totalPicks = ranking.reduce((sum, item) => sum + item.count, 0);

  setText(options.contestId, contestValue);
  setText(options.entriesId, contestEntries.length);
  setText(options.picksId, totalPicks);

  tbody.innerHTML = '';
  ranking.slice(0, 20).forEach((item, idx) => {
    const share = totalPicks > 0 ? ((item.count / totalPicks) * 100).toFixed(2) : '0.00';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${String(item.number).padStart(2, '0')}</td>
      <td>${item.count}</td>
      <td>${share}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderWinningNumbersTrend() {
  const tbody = document.getElementById('winningTrendTableBody');
  const freqBody = document.getElementById('winningTrendFrequencyBody');
  if (!tbody || !freqBody) return;

  const sorted = [...state.results].sort((a, b) => {
    const aNum = Number(a.contest);
    const bNum = Number(b.contest);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return bNum - aNum;
    return String(b.contest || '').localeCompare(String(a.contest || ''));
  });

  const lastSeven = sorted.slice(0, 7);
  if (!lastSeven.length) {
    setText('trendTopNumber', '—');
    setText('trendTopCount', 0);
    setText('trendUniqueWinners', 0);
    setText('trendLatestCarryCount', '0/5');
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No results data</td></tr>';
    freqBody.innerHTML = '<tr><td colspan="5" class="muted">No results data</td></tr>';
    return;
  }

  const frequency = Array.from({ length: 80 }, () => 0);
  lastSeven.forEach(result => {
    result.winningNumbers.forEach(num => {
      if (num >= 1 && num <= 80) frequency[num - 1] += 1;
    });
  });

  const sortedFrequency = frequency.map((count, idx) => ({ number: idx + 1, count }))
    .sort((a, b) => b.count - a.count || a.number - b.number);
  const topCount = sortedFrequency[0]?.count || 0;
  const topNumbers = sortedFrequency.filter(row => row.count === topCount && topCount > 0)
    .slice(0, 3).map(row => String(row.number).padStart(2, '0'));

  const uniqueWinners = sortedFrequency.filter(row => row.count > 0).length;
  const latestRepeated = lastSeven[1]
    ? lastSeven[0].winningNumbers.filter(num => lastSeven[1].winningNumbers.includes(num))
    : [];

  setText('trendTopNumber', topNumbers.join(', ') || '—');
  setText('trendTopCount', topCount);
  setText('trendUniqueWinners', uniqueWinners);
  setText('trendLatestCarryCount', `${latestRepeated.length}/5`);

  tbody.innerHTML = '';
  lastSeven.forEach((result, idx) => {
    const prev = lastSeven[idx + 1];
    const repeated = prev ? result.winningNumbers.filter(num => prev.winningNumbers.includes(num)) : [];
    const carryPct = ((repeated.length / 5) * 100).toFixed(0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${result.contest}</td>
      <td>${result.displayDrawDate || result.drawDate}</td>
      <td>${result.winningNumbers.map(n => String(n).padStart(2, '0')).join(', ')}</td>
      <td>${repeated.length ? repeated.map(n => String(n).padStart(2, '0')).join(', ') : '—'}</td>
      <td>${repeated.length ? carryPct + '%' : '0%'}</td>
    `;
    tbody.appendChild(tr);
  });

  freqBody.innerHTML = '';
  sortedFrequency.filter(row => row.count > 0).slice(0, 15).forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${String(row.number).padStart(2, '0')}</td>
      <td>${row.count}</td>
      <td>${lastSeven[0]?.contest || ''}</td>
      <td>${lastSeven[0]?.displayDrawDate || ''}</td>
      <td>${lastSeven.map(r => r.contest).join(', ')}</td>
    `;
    freqBody.appendChild(tr);
  });
}

function renderContestWinnersBreakdown() {
  const container = document.getElementById('contestWinnersBreakdown');
  if (!container) return;
  container.innerHTML = '';

  const grouped = {};
  state.winners.forEach(w => {
    const key = `${w.platform}_${w.contest}_${w.drawDate}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(w);
  });

  Object.values(grouped).forEach(group => {
    const sample = group[0];
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    group.forEach(w => {
      const matches = w.validation?.matches || 0;
      if (counts[matches] !== undefined) counts[matches] += 1;
    });

    const card = document.createElement('div');
    card.className = 'breakdown-card';
    card.innerHTML = `
      <h4>${sample.platform} Contest ${sample.contest}</h4>
      <div class="breakdown-pill">${sample.drawDate}</div>
      <div class="mini-grid" style="margin-top: 8px;">
        <div class="mini-stat"><span>5 hits</span><strong>${counts[5]}</strong></div>
        <div class="mini-stat"><span>4 hits</span><strong>${counts[4]}</strong></div>
        <div class="mini-stat"><span>3 hits</span><strong>${counts[3]}</strong></div>
        <div class="mini-stat"><span>2 hits</span><strong>${counts[2]}</strong></div>
        <div class="mini-stat"><span>1 hit</span><strong>${counts[1]}</strong></div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderPlayerBehavior() {
  const playerCounts = {};
  const hourCounts = Array.from({ length: 24 }, () => 0);

  state.validatedEntries.forEach(entry => {
    const playerKey = (entry.whatsapp || '').trim() || `${entry.platform}_${entry.gameId}`;
    playerCounts[playerKey] = (playerCounts[playerKey] || 0) + 1;

    const timeObj = entry.ticketTimeObj || AdminUtils.parseISO(entry.createdAtRaw);
    if (timeObj) {
      const hour = timeObj.getHours();
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) hourCounts[hour] += 1;
    }
  });

  const playerEntries = Object.entries(playerCounts).sort((a, b) => b[1] - a[1]);
  const uniquePlayers = playerEntries.length;
  const repeatPlayers = playerEntries.filter(([, count]) => count >= 2).length;
  const avgTickets = uniquePlayers > 0 ? (state.validatedEntries.length / uniquePlayers).toFixed(2) : '0.00';
  const repeatRate = uniquePlayers > 0 ? ((repeatPlayers / uniquePlayers) * 100).toFixed(2) : '0.00';

  let busiestHour = 0;
  let busiestHourTickets = hourCounts[0] || 0;
  hourCounts.forEach((count, hour) => {
    if (count > busiestHourTickets) {
      busiestHour = hour;
      busiestHourTickets = count;
    }
  });

  setText('repeatPlayerRate', `${repeatRate}%`);
  setText('avgTicketsPerPlayer', avgTickets);
  setText('busiestHourLabel', `${String(busiestHour).padStart(2, '0')}:00`);
  setText('busiestHourTickets', busiestHourTickets);

  const hourBody = document.getElementById('playerHourDistributionBody');
  if (hourBody) {
    hourBody.innerHTML = '';
    const avgPerHour = state.validatedEntries.length > 0 ? state.validatedEntries.length / 24 : 0;
    hourCounts.map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count || a.hour - b.hour)
      .slice(0, 12)
      .forEach(row => {
        const share = state.validatedEntries.length > 0 ? ((row.count / state.validatedEntries.length) * 100).toFixed(2) : '0.00';
        const deltaVsAvg = avgPerHour > 0 ? ((row.count - avgPerHour) / avgPerHour) * 100 : 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${String(row.hour).padStart(2, '0')}:00</td>
          <td>${row.count}</td>
          <td>${share}%</td>
          <td>${avgPerHour > 0 ? `${deltaVsAvg >= 0 ? '+' : ''}${deltaVsAvg.toFixed(1)}%` : 'n/a'}</td>
        `;
        hourBody.appendChild(tr);
      });
  }

  const topBody = document.getElementById('topRepeatPlayersBody');
  if (topBody) {
    topBody.innerHTML = '';
    const topRows = playerEntries.slice(0, 15);
    topRows.forEach(([player, count], index) => {
      const ticketShare = state.validatedEntries.length > 0 ? ((count / state.validatedEntries.length) * 100).toFixed(2) : '0.00';
      const type = count >= 2 ? 'Repeat' : 'Single';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${formatPlayerId(player)}</td>
        <td>${count}</td>
        <td>${ticketShare}%</td>
        <td>${type}</td>
      `;
      topBody.appendChild(tr);
    });
  }
}

function renderAnomalies() {
  const tbody = document.getElementById('anomalyTable');
  tbody.innerHTML = '';

  const entriesByDate = {};
  state.validatedEntries.forEach(entry => {
    const key = entry.registrationDateTime ? entry.registrationDateTime.split(' ')[0].split('/').reverse().join('-') : '';
    if (!key) return;
    if (!entriesByDate[key]) entriesByDate[key] = [];
    entriesByDate[key].push(entry);
  });

  const sortedDates = Object.keys(entriesByDate).sort((a, b) => b.localeCompare(a));
  if (!sortedDates.length) return;

  const latest = sortedDates[0];
  const previousDates = sortedDates.slice(1, 8);
  const latestEntries = entriesByDate[latest] || [];
  const baselineCounts = previousDates.map(date => (entriesByDate[date] || []).length);
  const baselineAvg = baselineCounts.length ? baselineCounts.reduce((a, b) => a + b, 0) / baselineCounts.length : 0;

  const spikeDelta = baselineAvg > 0 ? ((latestEntries.length - baselineAvg) / baselineAvg) * 100 : 0;
  const spikeSeverity = baselineAvg <= 0 ? 'ok' : spikeDelta >= 100 ? 'danger' : spikeDelta >= 50 ? 'warn' : 'ok';

  const rows = [
    {
      signal: 'Ticket Volume Spike',
      latest: latestEntries.length,
      baseline: baselineAvg.toFixed(1),
      delta: `${spikeDelta.toFixed(1)}%`,
      severity: spikeSeverity,
      notes: `Latest day ${latest} vs previous ${previousDates.length} active days`
    }
  ];

  const numberFreq = {};
  for (let i = 1; i <= 80; i++) numberFreq[i] = 0;
  latestEntries.forEach(entry => {
    entry.chosenNumbers.forEach(num => {
      if (num >= 1 && num <= 80) numberFreq[num] += 1;
    });
  });

  const totalPicks = Object.values(numberFreq).reduce((a, b) => a + b, 0);
  const topCount = Math.max(...Object.values(numberFreq));
  const dominance = totalPicks > 0 ? (topCount / totalPicks) * 100 : 0;

  const dominanceSeverity = dominance >= 12 ? 'danger' : dominance >= 8 ? 'warn' : 'ok';
  rows.push({
    signal: 'Dominant Number Concentration',
    latest: `${dominance.toFixed(2)}%`,
    baseline: baselineAvg > 0 ? baselineAvg.toFixed(1) : 'n/a',
    delta: 'n/a',
    severity: dominanceSeverity,
    notes: 'Warning >= 8%, Danger >= 12%'
  });

  ['POPLUZ', 'POPN1'].forEach(platform => {
    const latestCount = latestEntries.filter(e => e.platform === platform).length;
    const prevCounts = previousDates.map(date => (entriesByDate[date] || []).filter(e => e.platform === platform).length);
    const prevAvg = prevCounts.length ? prevCounts.reduce((a, b) => a + b, 0) / prevCounts.length : 0;
    const drop = prevAvg > 0 ? ((latestCount - prevAvg) / prevAvg) * 100 : 0;
    const severity = prevAvg < 5 ? 'ok' : drop <= -60 ? 'danger' : drop <= -40 ? 'warn' : 'ok';
    rows.push({
      signal: `Platform Drop (${platform})`,
      latest: latestCount,
      baseline: prevAvg.toFixed(1),
      delta: `${drop.toFixed(1)}%`,
      severity,
      notes: 'Warning <= -40%, Danger <= -60%'
    });
  });

  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.signal}</td>
      <td>${row.latest}</td>
      <td>${row.baseline}</td>
      <td>${row.delta}</td>
      <td class="sev-${row.severity}">${row.severity.toUpperCase()}</td>
      <td>${row.notes}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateFilters() {
  const platforms = ['ALL', ...new Set(state.entries.map(e => e.platform))];
  fillSelect('filterPlatform', platforms);
  fillSelect('filterRechargePlatform', ['ALL', ...new Set(state.recharges.map(r => r.platform))]);
  fillSelect('filterWinnerPlatform', ['ALL', ...new Set([...state.winners.map(w => w.platform), ...state.entries.map(e => e.platform)].filter(Boolean))]);

  fillSelect('filterContest', ['ALL', ...new Set(state.entries.map(e => e.contest).filter(Boolean))]);
  fillSelect('filterDrawDate', ['ALL', ...new Set(state.entries.map(e => e.drawDate).filter(Boolean))]);
  fillSelect('filterValidity', ['ALL', 'VALID', 'INVALID', 'PENDING', 'UNKNOWN']);
  fillSelect('filterCutoff', ['ALL', 'YES', 'NO']);

  fillSelect('filterWinnerContest', ['ALL', ...new Set(state.results.map(r => r.contest).filter(Boolean))]);
  fillSelect('filterWinnerDrawDate', ['ALL', ...new Set(state.results.map(r => r.drawDate).filter(Boolean))]);
  fillSelect('filterWinnerTier', ['ALL', 'JACKPOT', '4 NUMBERS', '3 NUMBERS', '2 NUMBERS', '1 NUMBER']);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function fillSelect(id, values) {
  const select = document.getElementById(id);
  if (!select) return;
  const previous = select.value;
  select.innerHTML = values.map(val => `<option value="${val}">${val}</option>`).join('');
  if (values.includes(previous)) select.value = previous;
}

function renderEntries() {
  const tbody = document.getElementById('entriesTableBody');
  tbody.innerHTML = '';

  let entries = [...state.validatedEntries];

  const platform = getFilter('filterPlatform');
  const gameId = getInput('filterGameId');
  const whatsapp = getInput('filterWhatsapp');
  const contest = getFilter('filterContest');
  const drawDate = getFilter('filterDrawDate');
  const validity = getFilter('filterValidity');
  const cutoff = getFilter('filterCutoff');

  entries = entries.filter(e => {
    if (platform && platform !== 'ALL' && e.platform !== platform) return false;
    if (gameId && !e.gameId.toLowerCase().includes(gameId)) return false;
    if (whatsapp && !e.whatsapp.toLowerCase().includes(whatsapp)) return false;
    if (contest && contest !== 'ALL' && e.contest !== contest) return false;
    if (drawDate && drawDate !== 'ALL' && e.drawDate !== drawDate) return false;
    if (validity && validity !== 'ALL' && e.validity !== validity) return false;
    if (cutoff && cutoff !== 'ALL') {
      const flag = cutoff === 'YES';
      if (e.cutoffFlag !== flag) return false;
    }
    return true;
  });

  entries = sortEntries(entries);

  state.entriesPaging.total = entries.length;
  state.entriesPaging.totalPages = Math.max(1, Math.ceil(entries.length / state.entriesPaging.pageSize));
  if (state.entriesPaging.page > state.entriesPaging.totalPages) {
    state.entriesPaging.page = state.entriesPaging.totalPages;
  }

  const startIndex = (state.entriesPaging.page - 1) * state.entriesPaging.pageSize;
  const endIndex = startIndex + state.entriesPaging.pageSize;
  const visibleEntries = entries.slice(startIndex, endIndex);

  visibleEntries.forEach(entry => {
    const platformHtml = formatPlatformBadge(entry.platform);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${entry.registrationDateTime}</td>
      <td>${platformHtml}</td>
      <td>${entry.gameId}</td>
      <td>${entry.whatsapp}</td>
      <td>${entry.chosenNumbers.join(', ')}</td>
      <td>${entry.displayDrawDate || entry.drawDate}</td>
      <td>${entry.contest}</td>
      <td>${entry.ticketNumber}</td>
      <td>${entry.validity}</td>
      <td>${entry.invalidReasonCode || ''}</td>
      <td>${entry.boundRechargeId || ''}</td>
      <td>${entry.cutoffFlag ? 'YES' : 'NO'}</td>
      <td><button class="btn link" data-ticket="${entry.ticketNumber}">Details</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-ticket]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ticket = btn.getAttribute('data-ticket');
      const entry = visibleEntries.find(e => e.ticketNumber === ticket);
      if (entry) showEntryDetails(entry);
    });
  });

  renderEntriesPagination();
}

function renderEntriesPagination() {
  const info = document.getElementById('entriesPageInfo');
  const prev = document.getElementById('entriesPrevPage');
  const next = document.getElementById('entriesNextPage');
  const size = document.getElementById('entriesPageSize');
  if (!info || !prev || !next || !size) return;

  const { page, totalPages, total, pageSize } = state.entriesPaging;
  const knownTotalEntries = state.incremental.totals.entries;
  const effectiveTotal = Number.isFinite(knownTotalEntries) ? knownTotalEntries : total;
  const effectivePages = Math.max(1, Math.ceil(effectiveTotal / pageSize));
  const isComplete = state.incremental.entries.done || (Number.isFinite(knownTotalEntries) && state.entries.length >= knownTotalEntries);
  const totalLabel = isComplete ? String(effectivePages) : `${effectivePages}+`;
  const countLabel = Number.isFinite(knownTotalEntries)
    ? `${Math.max(total, state.entries.length)}/${knownTotalEntries}`
    : (isComplete ? `${total}` : `${total}+`);
  info.textContent = `Page ${page} of ${totalLabel} (${countLabel} loaded entries)`;
  prev.disabled = page <= 1;
  next.disabled = page >= effectivePages && isComplete;
  if (String(size.value) !== String(pageSize)) size.value = String(pageSize);
}

function renderResults() {
  const tbody = document.getElementById('resultsTableBody');
  tbody.innerHTML = '';
  state.results.forEach(res => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${res.contest}</td>
      <td>${res.displayDrawDate || res.drawDate}</td>
      <td>${res.winningNumbers.map(n => String(n).padStart(2, '0')).join(', ')}</td>
      <td>${res.createdAt ? AdminUtils.formatBrtDateTime(AdminUtils.parseISO(res.createdAt)) : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderRecharges() {
  const tbody = document.getElementById('rechargesTableBody');
  tbody.innerHTML = '';

  let list = [...state.recharges];
  const platform = getFilter('filterRechargePlatform');
  const memberId = getInput('filterMemberId');

  list = list.filter(r => {
    if (platform && platform !== 'ALL' && r.platform !== platform) return false;
    if (memberId && !r.memberId.toLowerCase().includes(memberId)) return false;
    return true;
  });

  list.forEach(r => {
    const platformHtml = formatPlatformBadge(r.platform);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.rechargeTime}</td>
      <td>${platformHtml}</td>
      <td>${r.memberId}</td>
      <td>${r.orderNumber}</td>
      <td>${r.rechargeAmount}</td>
      <td>${r.balanceAfter}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderWinners() {
  const tbody = document.getElementById('winnersTableBody');
  tbody.innerHTML = '';

  let list = [...state.winners];
  const platform = getFilter('filterWinnerPlatform');
  const contest = getFilter('filterWinnerContest');
  const drawDate = getFilter('filterWinnerDrawDate');
  const tier = getFilter('filterWinnerTier');
  const whatsapp = getInput('filterWinnerWhatsapp');

  list = list.filter(w => {
    const tierLabel = getWinnerTierLabel(w);
    if (platform && platform !== 'ALL' && w.platform !== platform) return false;
    if (contest && contest !== 'ALL' && w.contest !== contest) return false;
    if (drawDate && drawDate !== 'ALL' && w.drawDate !== drawDate) return false;
    if (tier && tier !== 'ALL' && tierLabel !== tier) return false;
    if (whatsapp && !String(w.whatsapp).toLowerCase().includes(whatsapp)) return false;
    return true;
  });

  const grouped = {};
  list.forEach(w => {
    const key = `${w.platform}_${w.contest}_${w.drawDate}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(w);
  });

  const withPrize = [];
  Object.values(grouped).forEach(group => {
    const prize = 900 / group.length;
    group.forEach(w => withPrize.push({ ...w, prize }));
  });

  withPrize.sort((a, b) => compareWinnerRowsDesc(a, b));
  const latestContestKey = withPrize.length ? `${withPrize[0].contest || ''}_${withPrize[0].drawDate || ''}` : '';

  if (!withPrize.length) {
    const tr = document.createElement('tr');
    if (state.incremental.winnersFastError) {
      tr.innerHTML = `<td colspan="10" class="muted">Winners fast endpoint error: ${state.incremental.winnersFastError}</td>`;
      tbody.appendChild(tr);
      return;
    }
    const pendingLoad = state.incremental.winnersBackfill || !state.incremental.entries.done || !state.incremental.recharges.done || !state.incremental.results.done;
    tr.innerHTML = `<td colspan="10" class="muted">${pendingLoad ? 'Loading historical data for winners...' : 'No winners found for current filters.'}</td>`;
    tbody.appendChild(tr);
  }

  withPrize.forEach(w => {
    const tr = document.createElement('tr');
    const numbersHtml = formatWinnerNumbersHtml(w);
    const tierLabel = getWinnerTierLabel(w);
    const platformHtml = formatPlatformBadge(w.platform);
    const rowContestKey = `${w.contest || ''}_${w.drawDate || ''}`;
    const isLatestContest = !!latestContestKey && rowContestKey === latestContestKey;
    if (isLatestContest) tr.classList.add('winner-latest-row');

    const encodedPlatform = encodeURIComponent(String(w.platform || ''));
    const encodedGameId = encodeURIComponent(String(w.gameId || ''));
    const encodedWhatsapp = encodeURIComponent(String(w.whatsapp || ''));
    tr.innerHTML = `
      <td>R$ ${w.prize.toFixed(2)}</td>
      <td>${tierLabel}${isLatestContest ? ' <span class="winner-latest-badge">LATEST CONCURSO</span>' : ''}</td>
      <td>${w.validation?.matches || 0}</td>
      <td>${platformHtml}</td>
      <td>${w.gameId}</td>
      <td>${w.whatsapp}</td>
      <td>${w.contest}</td>
      <td>${AdminUtils.formatYMD(w.drawDate) || w.drawDate}</td>
      <td>${numbersHtml}</td>
      <td><button class="btn link" data-winner-platform="${encodedPlatform}" data-winner-gameid="${encodedGameId}" data-winner-whatsapp="${encodedWhatsapp}">Details</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-winner-platform]').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = decodeURIComponent(btn.getAttribute('data-winner-platform') || '');
      const gameId = decodeURIComponent(btn.getAttribute('data-winner-gameid') || '');
      const whatsapp = decodeURIComponent(btn.getAttribute('data-winner-whatsapp') || '');
      showWinnerDetails({ platform, gameId, whatsapp }).catch(err => {
        setStatus('Error');
        console.error(err);
      });
    });
  });

  const title = document.getElementById('winnersTitle');
  if (title) {
    title.textContent = state.winnerMode === 'manual'
      ? 'Winners (Manual Approval)'
      : 'Winners (Auto Validity)';
  }
}

function getWinnerTierLabel(winner) {
  const matches = Number(winner?.validation?.matches);
  if (matches === 5) return 'JACKPOT';
  if (matches === 4) return '4 NUMBERS';
  if (matches === 3) return '3 NUMBERS';
  if (matches === 2) return '2 NUMBERS';
  if (matches === 1) return '1 NUMBER';

  const rawTier = String(winner?.validation?.prizeTier?.tier || '').trim().toUpperCase();
  if (rawTier === 'GRAND PRIZE') return 'JACKPOT';
  if (rawTier === '2ND PRIZE') return '4 NUMBERS';
  if (rawTier === '3RD PRIZE') return '3 NUMBERS';
  if (rawTier === 'CONSOLATION') return '2 NUMBERS';
  return rawTier || 'NO PRIZE';
}

function compareWinnerRowsDesc(a, b) {
  const ad = String(a?.drawDate || '');
  const bd = String(b?.drawDate || '');
  if (ad !== bd) return bd.localeCompare(ad);

  const ac = Number(a?.contest);
  const bc = Number(b?.contest);
  if (Number.isFinite(ac) && Number.isFinite(bc) && ac !== bc) return bc - ac;
  if (String(a?.contest || '') !== String(b?.contest || '')) {
    return String(b?.contest || '').localeCompare(String(a?.contest || ''));
  }

  const am = Number(a?.validation?.matches) || 0;
  const bm = Number(b?.validation?.matches) || 0;
  if (am !== bm) return bm - am;

  return String(a?.ticketNumber || '').localeCompare(String(b?.ticketNumber || ''));
}

function formatWinnerNumbersHtml(winner) {
  const chosenNumbers = Array.isArray(winner?.chosenNumbers) ? winner.chosenNumbers : [];
  const matchedNumbers = Array.isArray(winner?.validation?.matchedNumbers) ? winner.validation.matchedNumbers : [];
  const matchedSet = new Set(matchedNumbers.map(n => Number(n)).filter(n => Number.isFinite(n)));

  return chosenNumbers
    .map((num) => {
      const numeric = Number(num);
      const label = String(Number.isFinite(numeric) ? numeric : num).padStart(2, '0');
      const isHit = Number.isFinite(numeric) && matchedSet.has(numeric);
      const cls = isHit ? 'winner-number winner-number-hit' : 'winner-number';
      return `<span class="${cls}">${label}</span>`;
    })
    .join(', ');
}

function formatPlatformBadge(platform) {
  const value = String(platform || '').trim().toUpperCase();
  if (!value) return '<span class="platform-badge">—</span>';
  if (value === 'POPN1') return '<span class="platform-badge platform-popn1">POPN1</span>';
  if (value === 'POPLUZ') return '<span class="platform-badge platform-popluz">POPLUZ</span>';
  return `<span class="platform-badge">${value}</span>`;
}

async function showWinnerDetails(winner) {
  const modal = document.getElementById('winnerDetailsModal');
  const body = document.getElementById('winnerDetailsBody');
  if (!modal || !body) return;

  const platform = String(winner?.platform || '').toUpperCase();
  const gameId = String(winner?.gameId || '');
  const whatsapp = String(winner?.whatsapp || '');

  body.innerHTML = '<div class="ticket-card"><strong>Loading winner profile...</strong></div>';
  modal.classList.add('active');

  let profile;
  try {
    profile = await AdminApi.fetchWinnerProfile({ platform, gameId, whatsapp });
  } catch (error) {
    body.innerHTML = `<div class="ticket-card warn"><strong>Failed to load winner profile.</strong><br><span class="muted">${String(error?.message || error || 'Unknown error')}</span></div>`;
    throw error;
  }

  const tickets = profile?.tickets || {};
  const recharges = profile?.recharges || {};
  const whatsappScan = profile?.whatsappScan || {};

  const samePlatformIds = Array.isArray(whatsappScan.samePlatformGameIds) ? whatsappScan.samePlatformGameIds : [];
  const allIds = Array.isArray(whatsappScan.gameIdsAcrossPlatforms) ? whatsappScan.gameIdsAcrossPlatforms : [];
  const otherPlatforms = Array.isArray(whatsappScan.otherPlatforms) ? whatsappScan.otherPlatforms : [];

  body.innerHTML = `
    <div class="ticket-card">
      <strong>Winner Identity</strong>
      <div class="detail-grid">
        <div class="detail-item"><span>Platform</span><span>${formatPlatformBadge(platform)}</span></div>
        <div class="detail-item"><span>Game ID</span><span>${gameId || '—'}</span></div>
        <div class="detail-item"><span>WhatsApp</span><span>${whatsapp || '—'}</span></div>
      </div>
    </div>

    <div class="ticket-card">
      <strong>Ticket Summary (${platform})</strong>
      <div class="detail-grid">
        <div class="detail-item"><span>Total Tickets</span><span>${tickets.total ?? 0}</span></div>
        <div class="detail-item"><span>Valid</span><span>${tickets.valid ?? 0}</span></div>
        <div class="detail-item"><span>Invalid</span><span>${tickets.invalid ?? 0}</span></div>
        <div class="detail-item"><span>Pending</span><span>${tickets.pending ?? 0}</span></div>
        <div class="detail-item"><span>Unknown</span><span>${tickets.unknown ?? 0}</span></div>
      </div>
    </div>

    <div class="ticket-card">
      <strong>Recharge Summary (${platform})</strong>
      <div class="detail-grid">
        <div class="detail-item"><span>Total Recharge Count</span><span>${recharges.count ?? 0}</span></div>
        <div class="detail-item"><span>Total Recharge Amount</span><span>R$ ${Number(recharges.totalAmount || 0).toFixed(2)}</span></div>
        <div class="detail-item"><span>Latest Recharge Time</span><span>${recharges.latestRecordTime ? AdminUtils.formatBrtDateTime(AdminUtils.parseISO(recharges.latestRecordTime)) : '—'}</span></div>
      </div>
    </div>

    <div class="ticket-card ${whatsappScan.hasMultipleGameIds ? 'warn' : 'valid'}">
      <strong>WhatsApp Multi-Account Check</strong>
      <div class="detail-grid">
        <div class="detail-item"><span>Total Tickets (same WA)</span><span>${whatsappScan.totalTickets ?? 0}</span></div>
        <div class="detail-item"><span>Multiple Game IDs?</span><span>${whatsappScan.hasMultipleGameIds ? 'YES' : 'NO'}</span></div>
        <div class="detail-item"><span>Game IDs in ${platform}</span><span>${samePlatformIds.length ? samePlatformIds.join(', ') : '—'}</span></div>
        <div class="detail-item"><span>Game IDs all platforms</span><span>${allIds.length ? allIds.join(', ') : '—'}</span></div>
        <div class="detail-item"><span>Other platforms seen</span><span>${otherPlatforms.length ? otherPlatforms.join(', ') : '—'}</span></div>
      </div>
    </div>
  `;
}

function hideWinnerDetails() {
  const modal = document.getElementById('winnerDetailsModal');
  if (modal) modal.classList.remove('active');
}

function sortEntries(entries) {
  const { key, dir } = state.sort;
  return entries.sort((a, b) => {
    const av = key === 'registrationDateTime' ? (a.createdAtRaw || '') : (a[key] ?? '');
    const bv = key === 'registrationDateTime' ? (b.createdAtRaw || '') : (b[key] ?? '');
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function bindEvents() {
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      switchPage(page);
    });
  });

  document.getElementById('refreshBtn').addEventListener('click', loadAllData);
  document.getElementById('autoRefreshToggle').addEventListener('change', handleAutoRefresh);

  document.getElementById('applyEntryFilters').addEventListener('click', () => {
    state.entriesPaging.page = 1;
    renderEntries();
  });
  document.getElementById('clearEntryFilters').addEventListener('click', () => {
    clearFilters(['filterPlatform', 'filterContest', 'filterDrawDate', 'filterValidity', 'filterCutoff']);
    clearInputs(['filterGameId', 'filterWhatsapp']);
    state.entriesPaging.page = 1;
    renderEntries();
  });

  const entriesPrevPage = document.getElementById('entriesPrevPage');
  if (entriesPrevPage) {
    entriesPrevPage.addEventListener('click', () => {
      if (state.entriesPaging.page > 1) {
        state.entriesPaging.page -= 1;
        renderEntries();
      }
    });
  }

  const entriesNextPage = document.getElementById('entriesNextPage');
  if (entriesNextPage) {
    entriesNextPage.addEventListener('click', async () => {
      if (state.entriesPaging.page < state.entriesPaging.totalPages) {
        state.entriesPaging.page += 1;
        renderEntries();
        return;
      }

      if (!state.incremental.entries.done) {
        await fetchEntriesUntilPage(state.entriesPaging.page + 1);
        if (state.entriesPaging.page < state.entriesPaging.totalPages) {
          state.entriesPaging.page += 1;
          renderEntries();
        }
      }
    });
  }

  const entriesPageSize = document.getElementById('entriesPageSize');
  if (entriesPageSize) {
    entriesPageSize.addEventListener('change', () => {
      const value = Number(entriesPageSize.value);
      if (Number.isFinite(value) && value > 0) {
        state.entriesPaging.pageSize = value;
        state.entriesPaging.page = 1;
        renderEntries();
      }
    });
  }

  const bindDashboardPager = (type, prevId, nextId, sizeId, renderer) => {
    const prev = document.getElementById(prevId);
    const next = document.getElementById(nextId);
    const size = document.getElementById(sizeId);
    const paging = state.dashboardPaging[type];
    if (!paging) return;

    if (prev) {
      prev.addEventListener('click', () => {
        if (paging.page > 1) {
          paging.page -= 1;
          renderer();
        }
      });
    }

    if (next) {
      next.addEventListener('click', () => {
        if (paging.page < paging.totalPages) {
          paging.page += 1;
          renderer();
        }
      });
    }

    if (size) {
      size.addEventListener('change', () => {
        const value = Number(size.value);
        if (Number.isFinite(value) && value > 0) {
          paging.pageSize = value;
          paging.page = 1;
          renderer();
        }
      });
    }
  };

  bindDashboardPager('recent', 'recentPrevPage', 'recentNextPage', 'recentPageSize', renderRecentEntries);
  bindDashboardPager('daily', 'dailyPrevPage', 'dailyNextPage', 'dailyPageSize', renderDailyParticipation);

  document.getElementById('applyRechargeFilters').addEventListener('click', renderRecharges);
  document.getElementById('clearRechargeFilters').addEventListener('click', () => {
    clearFilters(['filterRechargePlatform']);
    clearInputs(['filterMemberId']);
    renderRecharges();
  });

  document.getElementById('applyWinnerFilters').addEventListener('click', () => {
    loadWinnersByCurrentFilters().catch(err => {
      setStatus('Error');
      console.error(err);
    });
  });
  document.getElementById('clearWinnerFilters').addEventListener('click', () => {
    clearFilters(['filterWinnerPlatform', 'filterWinnerContest', 'filterWinnerDrawDate', 'filterWinnerTier']);
    clearInputs(['filterWinnerWhatsapp']);
    loadWinnersByCurrentFilters().catch(err => {
      setStatus('Error');
      console.error(err);
    });
  });

  const syncWinnerContestBtn = document.getElementById('syncWinnerContest');
  if (syncWinnerContestBtn) {
    syncWinnerContestBtn.addEventListener('click', async () => {
      syncWinnerContestBtn.disabled = true;
      try {
        const ok = await syncCurrentWinnerContest();
        if (ok) {
          await loadWinnersByCurrentFilters();
        }
      } catch (err) {
        setStatus('Error');
        console.error(err);
      } finally {
        syncWinnerContestBtn.disabled = false;
      }
    });
  }

  document.getElementById('exportEntries').addEventListener('click', exportEntries);
  document.getElementById('exportRecharges').addEventListener('click', exportRecharges);
  document.getElementById('exportWinners').addEventListener('click', exportWinners);

  document.getElementById('saveResult').addEventListener('click', saveResult);

  const winnerModeSelect = document.getElementById('winnerModeSelect');
  if (winnerModeSelect) {
    winnerModeSelect.addEventListener('change', () => {
      state.winnerMode = winnerModeSelect.value;
      state.winners = state.winnerMode === 'manual' ? state.manualWinners : state.autoWinners;
      renderWinners();
      updateFilters();
    });
  }

  const chartMetricSelect = document.getElementById('chartMetricSelect');
  if (chartMetricSelect) {
    chartMetricSelect.addEventListener('change', renderEntriesTrend);
  }

  const contestPlatformFilter = document.getElementById('contestPlatformFilter');
  if (contestPlatformFilter) {
    contestPlatformFilter.addEventListener('change', renderContestCompare);
  }

  const closeModal = document.getElementById('closeEntryModal');
  if (closeModal) {
    closeModal.addEventListener('click', hideEntryDetails);
  }

  const closeWinnerModal = document.getElementById('closeWinnerModal');
  if (closeWinnerModal) {
    closeWinnerModal.addEventListener('click', hideWinnerDetails);
  }

  const modal = document.getElementById('entryDetailsModal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target.id === 'entryDetailsModal') hideEntryDetails();
    });
  }

  const winnerModal = document.getElementById('winnerDetailsModal');
  if (winnerModal) {
    winnerModal.addEventListener('click', (event) => {
      if (event.target.id === 'winnerDetailsModal') hideWinnerDetails();
    });
  }

  document.querySelectorAll('#entriesTable th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort.dir = state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc';
      state.sort.key = key;
      state.entriesPaging.page = 1;
      renderEntries();
    });
  });
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(section => section.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add('active');
  document.getElementById('pageTitle').textContent = page.charAt(0).toUpperCase() + page.slice(1);

  if (page === 'winners') {
    ensureWinnersDataReady().catch(err => {
      setStatus('Error');
      console.error(err);
    });
  }
}

function handleAutoRefresh(e) {
  if (e.target.checked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

let autoRefreshTimer = null;
const AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function startAutoRefresh() {
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  if (!autoRefreshToggle?.checked) return;
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadAllData().catch(err => {
        setStatus('Error');
        console.error(err);
      });
    }
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

function setStatus(text) {
  const status = document.getElementById('syncStatus');
  if (status) status.textContent = text;
}

function setLoading(isLoading) {
  const overlay = document.getElementById('loadingOverlay');
  const refreshBtn = document.getElementById('refreshBtn');
  if (overlay) {
    overlay.classList.toggle('active', isLoading);
    overlay.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }
  if (refreshBtn) refreshBtn.disabled = isLoading;
}

function dateKeyFromDate(date) {
  if (!date) return '';
  const f = AdminUtils.brtFields(date);
  const mm = String(f.month + 1).padStart(2, '0');
  const dd = String(f.day).padStart(2, '0');
  return `${f.year}-${mm}-${dd}`;
}

function formatPlayerId(player) {
  const value = String(player || '—').trim();
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 8) return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
  if (value.length > 14) return `${value.slice(0, 10)}...`;
  return value;
}

function showEntryDetails(entry) {
  const modal = document.getElementById('entryDetailsModal');
  const body = document.getElementById('entryDetailsBody');
  if (!modal || !body) return;

  const validityClass = entry.validity === 'VALID' ? 'valid' : entry.validity === 'INVALID' ? 'invalid' : 'warn';
  const cutoffNotice = entry.cutoffFlag ? `
    <div class="ticket-card warn">
      <strong>Cutoff time shift detected</strong><br>
      Ticket moved to next eligible draw day.
    </div>
  ` : '';

  body.innerHTML = `
    <div class="ticket-card ${validityClass}">
      <strong>${entry.validity}</strong><br>
      ${entry.invalidReasonCode ? `Reason: ${entry.invalidReasonCode}` : 'Ticket is valid'}
    </div>
    ${cutoffNotice}
    <div class="ticket-card">
      <strong>Ticket Information</strong>
      <div class="detail-grid">
        <div class="detail-item"><span>Game ID</span><span>${entry.gameId}</span></div>
        <div class="detail-item"><span>Platform</span><span>${entry.platform}</span></div>
        <div class="detail-item"><span>WhatsApp</span><span>${entry.whatsapp}</span></div>
        <div class="detail-item"><span>Ticket #</span><span>${entry.ticketNumber}</span></div>
        <div class="detail-item"><span>Registration Date</span><span>${entry.registrationDate}</span></div>
        <div class="detail-item"><span>Registration Time</span><span>${entry.registrationTime}</span></div>
        <div class="detail-item"><span>Contest</span><span>${entry.contest}</span></div>
        <div class="detail-item"><span>Draw Date</span><span>${entry.displayDrawDate || entry.drawDate}</span></div>
        <div class="detail-item"><span>Chosen Numbers</span><span>${entry.chosenNumbers.join(', ')}</span></div>
      </div>
    </div>
    <div class="ticket-card">
      <strong>Bound Recharge Information</strong>
      <div class="detail-grid">
        <div class="detail-item"><span>Recharge ID</span><span>${entry.boundRechargeId || '—'}</span></div>
        <div class="detail-item"><span>Recharge Time</span><span>${entry.boundRechargeTime || '—'}</span></div>
        <div class="detail-item"><span>Recharge Amount</span><span>${entry.boundRechargeAmount || '—'}</span></div>
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function hideEntryDetails() {
  const modal = document.getElementById('entryDetailsModal');
  if (modal) modal.classList.remove('active');
}

function getFilter(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function getInput(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim().toLowerCase() : '';
}

function clearFilters(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'ALL';
  });
}

function clearInputs(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function exportEntries() {
  const rows = [
    ['Time', 'Platform', 'Game ID', 'WhatsApp', 'Numbers', 'Draw Date', 'Contest', 'Ticket', 'Validity', 'Reason', 'Recharge ID', 'Cutoff']
  ];
  document.querySelectorAll('#entriesTableBody tr').forEach(tr => {
    rows.push([...tr.children].map(td => td.textContent));
  });
  AdminUtils.downloadCsv('entries.csv', rows);
}

function exportRecharges() {
  const rows = [['Time', 'Platform', 'Member ID', 'Order', 'Amount', 'Balance']];
  document.querySelectorAll('#rechargesTableBody tr').forEach(tr => {
    rows.push([...tr.children].map(td => td.textContent));
  });
  AdminUtils.downloadCsv('recharges.csv', rows);
}

function exportWinners() {
  const rows = [['Prize', 'Tier', 'Matches', 'Platform', 'Game ID', 'WhatsApp', 'Contest', 'Draw Date', 'Numbers']];
  document.querySelectorAll('#winnersTableBody tr').forEach(tr => {
    rows.push([...tr.children].map(td => td.textContent));
  });
  AdminUtils.downloadCsv('winners.csv', rows);
}

async function saveResult() {
  const status = document.getElementById('saveResultStatus');
  status.textContent = '';

  const payload = {
    contest: document.getElementById('resultContest').value.trim(),
    draw_date: document.getElementById('resultDrawDate').value,
    num1: document.getElementById('resultNum1').value,
    num2: document.getElementById('resultNum2').value,
    num3: document.getElementById('resultNum3').value,
    num4: document.getElementById('resultNum4').value,
    num5: document.getElementById('resultNum5').value
  };

  try {
    await AdminApi.createResult(payload);
    status.textContent = 'Saved.';
    await loadAllData();
  } catch (err) {
    status.textContent = err.message;
  }
}

function init() {
  bindEvents();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const autoRefreshToggle = document.getElementById('autoRefreshToggle');
      if (autoRefreshToggle?.checked) {
        loadAllData().catch(err => {
          setStatus('Error');
          console.error(err);
        });
      }
    }
  });
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  if (autoRefreshToggle?.checked) {
    startAutoRefresh();
  }
  loadAllData().catch(err => {
    setStatus('Error');
    console.error(err);
  });

  const winnersPage = document.getElementById('page-winners');
  if (winnersPage?.classList.contains('active')) {
    ensureWinnersDataReady().catch(err => {
      setStatus('Error');
      console.error(err);
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
