let autoRefreshInterval = null;
let dashboardChartInstance = null;

/**
 * DASHBOARD PAGE LOGIC
 */
async function initDashboard() {
    showLoading(true, 'Initializing dashboard...', 0);
    hideError();

    try {
        // Step 1: Fetch entries data
        showLoading(true, 'Loading lottery entries...', 20);
        await dataFetcher.fetchData();
        console.log('✅ Entries loaded:', dataFetcher.entries.length);
        console.log('📊 Sample entry:', JSON.stringify(dataFetcher.entries[0], null, 2));
        console.log('🎮 Entry gameIds (first 5):', dataFetcher.entries.slice(0, 5).map(e => e.gameId));

        // Step 2: Fetch results data
        showLoading(true, 'Loading contest results...', 40);
        await resultsFetcher.fetchResults();

        // Step 3: Fetch recharge data
        showLoading(true, 'Loading recharge data...', 60);
        await rechargeValidator.fetchRechargeData();
        console.log('✅ Recharges loaded:', rechargeValidator.recharges.length);
        console.log('📊 Sample recharge:', JSON.stringify(rechargeValidator.recharges[0], null, 2));
        console.log('🎮 Recharge platforms (first 5):', rechargeValidator.recharges.slice(0, 5).map(r => `${r.platform}:${r.gameId}`));

        // Step 4: Validate entries against recharges (CRITICAL!)
        showLoading(true, 'Validating entries against recharges...', 70);
        const rawEntries = dataFetcher.getAllEntries();
        const validatedEntries = rechargeValidator.validateEntries(rawEntries);
        console.log('✅ Validation complete!');
        console.log('📊 Valid tickets:', validatedEntries.filter(e => e.validity === 'VALID').length);
        console.log('📊 Invalid tickets:', validatedEntries.filter(e => e.validity === 'INVALID').length);
        
        // Update dataFetcher with validated entries
        dataFetcher.entries = validatedEntries;

        // Step 5: Set winning numbers for contests
        showLoading(true, 'Setting winning numbers...', 90);
        validator.setResults(resultsFetcher.getAllResults());

        // Step 6: Update UI
        showLoading(true, 'Updating dashboard...', 100);
        updateDashboard();
        updateLastUpdateTime();
        setAccountBanner();

        showSuccess('✅ Data loaded successfully! Dashboard updated.');
    } catch (error) {
        showError('❌ Failed to load data: ' + error.message);
        console.error('Dashboard initialization error:', error);
    } finally {
        showLoading(false);
    }
}

function updateDashboard() {
    const entries = dataFetcher.getAllEntries();
    const stats = dataFetcher.getStatistics();
    
    // Map csvStatus to status for winner validation
    const entriesWithStatus = entries.map(e => ({ 
        ...e, 
        status: e.csvStatus || e.status 
    }));
    
    const winners = validator.getWinners(entriesWithStatus);
    
    // Calculate prizes per platform per tier
    calculateWinnerPrizes(winners);
    
    const results = validator.getAllResults();
    const recharges = rechargeValidator.recharges || [];

    // Platform breakdown
    const popluzEntries = entries.filter(e => e.platform === 'POPLUZ');
    const popn1Entries = entries.filter(e => e.platform === 'POPN1');
    const popluzWinners = winners.filter(w => w.platform === 'POPLUZ');
    const popn1Winners = winners.filter(w => w.platform === 'POPN1');

    setText('totalEntries', stats.totalEntries);
    setText('popluzEntries', popluzEntries.length);
    setText('popn1Entries', popn1Entries.length);
    setText('uniqueContests', stats.uniqueContests);
    setText('uniqueDrawDates', stats.uniqueDrawDates);
    setText('pendingEntries', stats.pendingEntries);
    setText('totalWinners', winners.length);
    setText('popluzWinners', popluzWinners.length);
    setText('popn1Winners', popn1Winners.length);
    setText('winRate', `${stats.totalEntries > 0 ? ((winners.length / stats.totalEntries) * 100).toFixed(2) : '0'}%`);

    renderRechargeAnalytics(recharges, entries);
    renderDailyParticipation(recharges, entries);
    renderPlayerBehavior(entries);
    renderDailyAnomalyAlerts(entries);
    renderWinningNumbersTrend(results);
    renderCurrentContestNumberRanking(entries);
    renderPreviousContestNumberRanking(entries);
    renderContestWinnersBreakdown(entries, results, winners);
    renderDashboardTopPlayers(entries, winners);
    renderRecentEntries(entries);
    
    const metric = document.getElementById('chartMetricSelect')?.value || 'entries';
    renderEntriesVolumeChart(entries, recharges, metric);
}

function renderEntriesVolumeChart(entries, recharges, metric = 'entries') {
    const ctx = document.getElementById('dashboardChart')?.getContext('2d');
    if (!ctx) return;

    const byDate = {};
    const initDate = (d) => {
        if (!byDate[d]) byDate[d] = { entries: 0, rechargers: new Set(), participants: new Set() };
    };

    entries.forEach(e => {
        const key = dateKeyFromString(e.registrationDateTime);
        if (key) {
            initDate(key);
            byDate[key].entries++;
            byDate[key].participants.add(`${e.platform}_${e.gameId}`);
        }
    });

    recharges.forEach(r => {
        const key = r.rechargeTimeObj ? r.rechargeTimeObj.toISOString().slice(0, 10) : dateKeyFromString(r.rechargeTime);
        if (key) {
            initDate(key);
            byDate[key].rechargers.add(`${r.platform}_${r.gameId}`);
        }
    });

    const allDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
    const last7Dates = allDates.slice(0, 7).reverse();
    
    const getVal = (d) => {
        const data = byDate[d];
        if (metric === 'entries') return data.entries;
        if (metric === 'rechargers') return data.rechargers.size;
        if (metric === 'participants') return data.participants.size;
        if (metric === 'noTicket') {
            let count = 0;
            data.rechargers.forEach(key => { if (!data.participants.has(key)) count++; });
            return count;
        }
        return 0;
    };

    const labels = last7Dates.map(d => d.split('-').slice(1).reverse().join('/'));
    const values = last7Dates.map(getVal);

    if (dashboardChartInstance) {
        dashboardChartInstance.destroy();
    }

    const metricLabels = {
        'entries': 'Total Entries',
        'rechargers': 'Unique Rechargers',
        'participants': 'Unique Participants',
        'noTicket': 'Recharged No Ticket'
    };

    dashboardChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: metricLabels[metric] || 'Stats',
                data: values,
                borderColor: '#4db6ac', // Teal color from image
                backgroundColor: 'rgba(77, 182, 172, 0.1)',
                borderWidth: 5,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#4db6ac',
                pointBorderWidth: 4,
                pointRadius: 8,
                pointHoverRadius: 10,
                tension: 0, // Straight lines like in the image
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: { top: 20, right: 20 }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(77, 182, 172, 0.9)',
                    titleFont: { family: 'Manrope', size: 13, weight: 'bold' },
                    bodyFont: { family: 'Manrope', size: 12 },
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { 
                        color: 'rgba(0, 0, 0, 0.1)',
                        drawBorder: true,
                        lineWidth: 1
                    },
                    ticks: { 
                        font: { family: 'Manrope', weight: 'bold' }, 
                        color: '#6b7280',
                        stepSize: 10
                    },
                    border: { width: 3, color: '#444' } // Thick axis line
                },
                x: {
                    grid: { 
                        display: true,
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: { 
                        font: { family: 'Manrope', weight: 'bold' }, 
                        color: '#6b7280' 
                    },
                    border: { width: 3, color: '#444' } // Thick axis line
                }
            }
        }
    });
}

function renderRechargeAnalytics(recharges, entries) {
    // Use composite keys: platform_gameId
    const rechargeKeys = new Set(recharges.map(r => `${r.platform}_${r.gameId}`));
    const ticketKeys = new Set(entries.map(e => `${e.platform}_${e.gameId}`));
    const rechargedNoTicket = [...rechargeKeys].filter(key => !ticketKeys.has(key));
    const participated = rechargeKeys.size - rechargedNoTicket.length;
    const rate = rechargeKeys.size > 0 ? ((participated / rechargeKeys.size) * 100).toFixed(1) : '0';

    setText('statRechargers', rechargeKeys.size);
    setText('statParticipants', participated);
    setText('statNoTickets', rechargedNoTicket.length);
    setText('statParticipationRate', `${rate}%`);
    setText('pbRechargers', rechargeKeys.size);
    setText('pbParticipants', participated);
    setText('pbNoTicket', rechargedNoTicket.length);
    setText('pbRate', `${rate}%`);
}

function renderDailyParticipation(recharges, entries) {
    const byDate = {};
    recharges.forEach(r => {
        const key = r.rechargeTimeObj ? r.rechargeTimeObj.toISOString().slice(0, 10) : dateKeyFromString(r.rechargeTime);
        if (key) { if (!byDate[key]) byDate[key] = { rechargers: new Set(), ticketCreators: new Set(), ticketCount: 0 }; byDate[key].rechargers.add(`${r.platform}_${r.gameId}`); }
    });
    entries.forEach(e => {
        const key = dateKeyFromString(e.registrationDateTime);
        if (key) { if (!byDate[key]) byDate[key] = { rechargers: new Set(), ticketCreators: new Set(), ticketCount: 0 }; byDate[key].ticketCreators.add(`${e.platform}_${e.gameId}`); byDate[key].ticketCount++; }
    });

    const last7 = Object.keys(byDate).sort((a, b) => b.localeCompare(a)).slice(0, 7);
    const tbody = document.getElementById('dailyParticipationBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    last7.forEach(date => {
        const rec = byDate[date];
        const participation = rec.rechargers.size > 0 ? ((rec.ticketCreators.size / rec.rechargers.size) * 100).toFixed(2) : '—';
        const row = document.createElement('tr');
        row.innerHTML = `<td>${date}</td><td>${rec.rechargers.size}</td><td>${rec.ticketCreators.size}</td><td>${Math.max(rec.rechargers.size - rec.ticketCreators.size, 0)}</td><td>${participation === '—' ? '—' : participation + '%'}</td><td>${participation === '—' ? '—' : (100 - parseFloat(participation)).toFixed(2) + '%'}</td><td>${rec.ticketCount}</td>`;
        tbody.appendChild(row);
    });
}

function renderPlayerBehavior(entries) {
    const playerCounts = {};
    const hourCounts = Array.from({ length: 24 }, () => 0);

    entries.forEach(entry => {
        const playerKey = (entry.whatsapp || '').trim() || `${entry.platform || 'UNK'}_${entry.gameId || 'UNKNOWN'}`;
        playerCounts[playerKey] = (playerCounts[playerKey] || 0) + 1;

        const timeCandidate = (entry.registrationTime || '').trim() || String(entry.registrationDateTime || '').trim().split(' ')[1] || '';
        const hourMatch = timeCandidate.match(/^([0-2]?\d):/);
        if (hourMatch) {
            const hour = Number(hourMatch[1]);
            if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
                hourCounts[hour] += 1;
            }
        }
    });

    const playerEntries = Object.entries(playerCounts).sort((a, b) => b[1] - a[1]);
    const ticketCounts = playerEntries.map(([, count]) => count).sort((a, b) => a - b);
    const uniquePlayers = playerEntries.length;
    const repeatPlayers = playerEntries.filter(([, count]) => count >= 2).length;
    const oneTicketPlayers = playerEntries.filter(([, count]) => count === 1).length;
    const repeatRate = uniquePlayers > 0 ? ((repeatPlayers / uniquePlayers) * 100).toFixed(2) : '0.00';
    const avgTickets = uniquePlayers > 0 ? (entries.length / uniquePlayers).toFixed(2) : '0.00';

    let busiestHour = 0;
    let busiestHourTickets = hourCounts[0] || 0;
    hourCounts.forEach((count, hour) => {
        if (count > busiestHourTickets) {
            busiestHour = hour;
            busiestHourTickets = count;
        }
    });

    let peakThreeHourStart = 0;
    let peakThreeHourTickets = 0;
    for (let hour = 0; hour < 24; hour++) {
        const total = hourCounts[hour] + hourCounts[(hour + 1) % 24] + hourCounts[(hour + 2) % 24];
        if (total > peakThreeHourTickets) {
            peakThreeHourTickets = total;
            peakThreeHourStart = hour;
        }
    }

    const peakThreeHourEnd = (peakThreeHourStart + 2) % 24;
    const topPlayer = playerEntries[0] || ['—', 0];
    const avgPerHour = entries.length > 0 ? entries.length / 24 : 0;

    setText('repeatPlayerRate', `${repeatRate}%`);
    setText('avgTicketsPerPlayer', avgTickets);
    setText('busiestHourLabel', `${String(busiestHour).padStart(2, '0')}:00`);
    setText('busiestHourTickets', busiestHourTickets);
    setText('uniquePlayersCount', uniquePlayers);
    setText('repeatPlayersCount', repeatPlayers);
    setText('oneTicketPlayersCount', oneTicketPlayers);
    setText('peakThreeHourWindow', `${String(peakThreeHourStart).padStart(2, '0')}:00-${String(peakThreeHourEnd).padStart(2, '0')}:59`);
    setText('peakThreeHourTickets', peakThreeHourTickets);
    setText('topPlayerTickets', topPlayer[1]);

    const hourBody = document.getElementById('playerHourDistributionBody');
    if (hourBody) {
        hourBody.innerHTML = '';
        const hourRows = hourCounts
            .map((count, hour) => ({ hour, count }))
            .sort((a, b) => b.count - a.count || a.hour - b.hour)
            .slice(0, 12);

        hourRows.forEach(rowData => {
            const share = entries.length > 0 ? ((rowData.count / entries.length) * 100).toFixed(2) : '0.00';
            const deltaVsAvg = avgPerHour > 0 ? ((rowData.count - avgPerHour) / avgPerHour) * 100 : 0;
            const row = document.createElement('tr');
            row.innerHTML = `<td><strong>${String(rowData.hour).padStart(2, '0')}:00</strong></td><td>${rowData.count}</td><td>${share}%</td><td>${avgPerHour > 0 ? `${deltaVsAvg >= 0 ? '+' : ''}${deltaVsAvg.toFixed(1)}%` : 'n/a'}</td>`;
            hourBody.appendChild(row);
        });
    }

    const distributionBody = document.getElementById('playerTicketDistributionBody');
    if (distributionBody) {
        const buckets = [
            { label: '1 ticket', min: 1, max: 1 },
            { label: '2 tickets', min: 2, max: 2 },
            { label: '3-5 tickets', min: 3, max: 5 },
            { label: '6-10 tickets', min: 6, max: 10 },
            { label: '11+ tickets', min: 11, max: Number.POSITIVE_INFINITY }
        ];

        distributionBody.innerHTML = '';
        buckets.forEach(bucket => {
            const bucketPlayers = playerEntries.filter(([, count]) => count >= bucket.min && count <= bucket.max);
            const playerCount = bucketPlayers.length;
            const ticketSum = bucketPlayers.reduce((sum, [, count]) => sum + count, 0);
            const playerShare = uniquePlayers > 0 ? ((playerCount / uniquePlayers) * 100).toFixed(2) : '0.00';
            const ticketShare = entries.length > 0 ? ((ticketSum / entries.length) * 100).toFixed(2) : '0.00';
            const row = document.createElement('tr');
            row.innerHTML = `<td>${bucket.label}</td><td>${playerCount}</td><td>${playerShare}%</td><td>${ticketShare}%</td>`;
            distributionBody.appendChild(row);
        });
    }

    const topPlayersBody = document.getElementById('topRepeatPlayersBody');
    if (topPlayersBody) {
        topPlayersBody.innerHTML = '';
        const topRows = playerEntries.slice(0, 15);
        topRows.forEach(([player, count], index) => {
            const ticketShare = entries.length > 0 ? ((count / entries.length) * 100).toFixed(2) : '0.00';
            const type = count >= 2 ? 'Repeat' : 'Single';
            const row = document.createElement('tr');
            row.innerHTML = `<td>${index + 1}</td><td>${formatPlayerId(player)}</td><td>${count}</td><td>${ticketShare}%</td><td>${type}</td>`;
            topPlayersBody.appendChild(row);
        });
    }
}

function formatPlayerId(player) {
    const value = String(player || '—').trim();
    if (!value) return '—';
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8) {
        return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
    }
    if (value.length > 14) {
        return `${value.slice(0, 10)}...`;
    }
    return value;
}

function renderDailyAnomalyAlerts(entries) {
    const tbody = document.getElementById('anomalyDetailsBody');
    if (!tbody) return;

    const byDateEntries = {};
    entries.forEach(entry => {
        const dateKey = dateKeyFromString(entry.registrationDateTime);
        if (!dateKey) return;
        if (!byDateEntries[dateKey]) byDateEntries[dateKey] = [];
        byDateEntries[dateKey].push(entry);
    });

    const sortedDates = Object.keys(byDateEntries).sort((a, b) => b.localeCompare(a));
    if (sortedDates.length === 0) {
        setText('anomalyLatestDate', '—');
        setText('anomalyLatestTickets', 0);
        setText('anomalyBaselineTickets', 0);
        setText('anomalyAlertStatus', 'NO DATA');
        tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;">No valid date data to detect anomalies yet.</td></tr>';
        return;
    }

    const latestDate = sortedDates[0];
    const previousDates = sortedDates.slice(1, 8);
    const latestEntries = byDateEntries[latestDate] || [];
    const baselineCounts = previousDates.map(date => (byDateEntries[date] || []).length);
    const baselineAvg = baselineCounts.length > 0 ? baselineCounts.reduce((sum, value) => sum + value, 0) / baselineCounts.length : 0;

    const rows = [];

    const spikeDeltaPct = baselineAvg > 0 ? ((latestEntries.length - baselineAvg) / baselineAvg) * 100 : 0;
    const spikeTone = baselineAvg <= 0 ? 'ok' : (spikeDeltaPct >= 100 ? 'danger' : (spikeDeltaPct >= 50 ? 'warn' : 'ok'));
    rows.push({
        signal: 'Ticket Volume Spike',
        latest: latestEntries.length,
        baseline: baselineAvg > 0 ? baselineAvg.toFixed(1) : 'n/a',
        delta: baselineAvg > 0 ? `${spikeDeltaPct >= 0 ? '+' : ''}${spikeDeltaPct.toFixed(1)}%` : 'n/a',
        tone: spikeTone,
        details: baselineAvg > 0
            ? `Latest day ${latestDate} compared against prior ${Math.min(previousDates.length, 7)} active days.`
            : 'Baseline not enough yet (need previous active days).'
    });

    const numberFrequency = {};
    for (let number = 1; number <= 80; number++) numberFrequency[number] = 0;
    latestEntries.forEach(entry => {
        (entry.chosenNumbers || []).forEach(raw => {
            const parsed = Number(raw);
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 80) {
                numberFrequency[parsed] += 1;
            }
        });
    });

    const numberStats = Object.keys(numberFrequency)
        .map(key => ({ number: Number(key), count: numberFrequency[key] }))
        .sort((a, b) => b.count - a.count || a.number - b.number);
    const latestTotalPicks = numberStats.reduce((sum, row) => sum + row.count, 0);

    const topNumber = numberStats[0] || { number: 0, count: 0 };
    const topFiveNumbersText = numberStats
        .slice(0, 5)
        .map(item => `${String(item.number).padStart(2, '0')} (${item.count})`)
        .join(', ');
    const dominance = latestTotalPicks > 0 ? (topNumber.count / latestTotalPicks) * 100 : 0;

    const previousDominanceValues = previousDates.map(date => {
        const dayEntries = byDateEntries[date] || [];
        const dayFreq = {};
        for (let number = 1; number <= 80; number++) dayFreq[number] = 0;
        dayEntries.forEach(entry => {
            (entry.chosenNumbers || []).forEach(raw => {
                const parsed = Number(raw);
                if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 80) dayFreq[parsed] += 1;
            });
        });
        const dayValues = Object.values(dayFreq);
        const dayTotal = dayValues.reduce((sum, value) => sum + value, 0);
        const dayTop = dayValues.length > 0 ? Math.max(...dayValues) : 0;
        return dayTotal > 0 ? (dayTop / dayTotal) * 100 : 0;
    }).filter(value => value > 0);
    const dominanceBaseline = previousDominanceValues.length > 0
        ? previousDominanceValues.reduce((sum, value) => sum + value, 0) / previousDominanceValues.length
        : 0;
    const dominanceDelta = dominance - dominanceBaseline;
    const dominanceTone = latestTotalPicks <= 0
        ? 'ok'
        : (dominance >= 12 || dominanceDelta >= 5 ? 'danger' : (dominance >= 8 || dominanceDelta >= 3 ? 'warn' : 'ok'));

    rows.push({
        signal: 'Dominant Number Concentration',
        latest: latestTotalPicks > 0 ? `${String(topNumber.number).padStart(2, '0')} (${dominance.toFixed(2)}%)` : 'n/a',
        baseline: dominanceBaseline > 0 ? `${dominanceBaseline.toFixed(2)}%` : 'n/a',
        delta: latestTotalPicks > 0 && dominanceBaseline > 0 ? `${dominanceDelta >= 0 ? '+' : ''}${dominanceDelta.toFixed(2)} pp` : 'n/a',
        tone: dominanceTone,
        details: latestTotalPicks > 0
            ? `Top5 numbers: ${topFiveNumbersText}.`
            : 'No picks found on latest day.'
    });

    const platforms = ['POPLUZ', 'POPN1'];
    platforms.forEach(platform => {
        const latestPlatformCount = latestEntries.filter(entry => entry.platform === platform).length;
        const previousPlatformCounts = previousDates.map(date => (byDateEntries[date] || []).filter(entry => entry.platform === platform).length);
        const previousPlatformAvg = previousPlatformCounts.length > 0
            ? previousPlatformCounts.reduce((sum, value) => sum + value, 0) / previousPlatformCounts.length
            : 0;

        const dropDeltaPct = previousPlatformAvg > 0 ? ((latestPlatformCount - previousPlatformAvg) / previousPlatformAvg) * 100 : 0;
        const dropTone = previousPlatformAvg < 5
            ? 'ok'
            : (dropDeltaPct <= -60 ? 'danger' : (dropDeltaPct <= -40 ? 'warn' : 'ok'));

        rows.push({
            signal: `Platform Drop (${platform})`,
            latest: latestPlatformCount,
            baseline: previousPlatformAvg > 0 ? previousPlatformAvg.toFixed(1) : 'n/a',
            delta: previousPlatformAvg > 0 ? `${dropDeltaPct >= 0 ? '+' : ''}${dropDeltaPct.toFixed(1)}%` : 'n/a',
            tone: dropTone,
            details: `Latest ${platform} tickets on ${latestDate} compared with recent active days.`
        });
    });

    const severityRank = { ok: 0, warn: 1, danger: 2 };
    const worstSeverity = rows.reduce((worst, row) => (severityRank[row.tone] > severityRank[worst] ? row.tone : worst), 'ok');
    setText('anomalyLatestDate', latestDate);
    setText('anomalyLatestTickets', latestEntries.length);
    setText('anomalyBaselineTickets', baselineAvg > 0 ? baselineAvg.toFixed(1) : 0);
    setText('anomalyAlertStatus', worstSeverity.toUpperCase());

    tbody.innerHTML = '';
    rows.forEach(rowData => {
        const row = document.createElement('tr');
        row.innerHTML = `<td class="metric-strong">${rowData.signal}</td><td>${rowData.latest}</td><td>${rowData.baseline}</td><td>${rowData.delta}</td><td><span class="severity-badge severity-${rowData.tone}">${rowData.tone.toUpperCase()}</span></td><td>${rowData.details}</td>`;
        tbody.appendChild(row);
    });
}

function renderWinningNumbersTrend(results) {
    const tbody = document.getElementById('winningTrendTableBody');
    const freqBody = document.getElementById('winningTrendFrequencyBody');
    if (!tbody || !freqBody) return;

    const sorted = [...(results || [])].sort((a, b) => {
        const aNum = Number(a.contest);
        const bNum = Number(b.contest);
        const aIsNum = Number.isFinite(aNum);
        const bIsNum = Number.isFinite(bNum);
        if (aIsNum && bIsNum) return bNum - aNum;
        if (a.drawDate && b.drawDate && a.drawDate !== b.drawDate) return b.drawDate.localeCompare(a.drawDate);
        return String(b.contest || '').localeCompare(String(a.contest || ''));
    });

    const lastSeven = sorted.slice(0, 7);
    if (lastSeven.length === 0) {
        setText('trendTopNumber', '—');
        setText('trendTopCount', 0);
        setText('trendUniqueWinners', 0);
        setText('trendLatestCarryCount', '0/5');
        tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;">No results data found</td></tr>';
        freqBody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;">No frequency data found</td></tr>';
        return;
    }

    const winningFrequency = {};
    for (let number = 1; number <= 80; number++) winningFrequency[number] = 0;
    lastSeven.forEach(result => {
        (result.winningNumbers || []).forEach(number => {
            const parsed = Number(number);
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 80) {
                winningFrequency[parsed] += 1;
            }
        });
    });

    const sortedFrequency = Object.keys(winningFrequency)
        .map(key => ({ number: Number(key), count: winningFrequency[key] }))
        .sort((a, b) => b.count - a.count || a.number - b.number);

    const topCount = sortedFrequency[0]?.count || 0;
    const topNumbers = sortedFrequency
        .filter(row => row.count === topCount && topCount > 0)
        .slice(0, 3)
        .map(row => String(row.number).padStart(2, '0'));

    const uniqueWinners = sortedFrequency.filter(row => row.count > 0).length;

    const latestRepeated = lastSeven[1]
        ? (lastSeven[0].winningNumbers || []).filter(number => (lastSeven[1].winningNumbers || []).includes(number))
        : [];

    setText('trendTopNumber', topNumbers.length > 0 ? topNumbers.join(', ') : '—');
    setText('trendTopCount', topCount);
    setText('trendUniqueWinners', uniqueWinners);
    setText('trendLatestCarryCount', `${latestRepeated.length}/5`);

    tbody.innerHTML = '';
    lastSeven.forEach((result, index) => {
        const previousDraw = lastSeven[index + 1];
        const repeated = previousDraw
            ? (result.winningNumbers || []).filter(number => (previousDraw.winningNumbers || []).includes(number))
            : [];
        const carryPct = ((repeated.length / 5) * 100).toFixed(0);

        const row = document.createElement('tr');
        row.innerHTML = `<td><span class="badge badge-primary">${result.contest}</span></td><td>${formatDrawDisplay(result.displayDrawDate || result.drawDate)}</td><td><strong>${(result.winningNumbers || []).map(number => String(number).padStart(2, '0')).join(', ')}</strong></td><td>${repeated.length > 0 ? repeated.map(number => String(number).padStart(2, '0')).join(', ') : '—'}</td><td>${repeated.length > 0 ? carryPct + '%' : '0%'}</td>`;
        tbody.appendChild(row);
    });

    const appearancesByNumber = {};
    for (let number = 1; number <= 80; number++) {
        appearancesByNumber[number] = { count: 0, contests: [], drawDate: '' };
    }

    lastSeven.forEach(result => {
        (result.winningNumbers || []).forEach(number => {
            const parsed = Number(number);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 80) return;
            appearancesByNumber[parsed].count += 1;
            appearancesByNumber[parsed].contests.push(String(result.contest));
            if (!appearancesByNumber[parsed].drawDate) {
                appearancesByNumber[parsed].drawDate = result.displayDrawDate || result.drawDate || '';
            }
        });
    });

    const frequencyRows = Object.keys(appearancesByNumber)
        .map(key => ({ number: Number(key), ...appearancesByNumber[key] }))
        .filter(row => row.count > 0)
        .sort((a, b) => b.count - a.count || a.number - b.number)
        .slice(0, 15);

    freqBody.innerHTML = '';
    frequencyRows.forEach(rowData => {
        const row = document.createElement('tr');
        row.innerHTML = `<td><strong>${String(rowData.number).padStart(2, '0')}</strong></td><td>${rowData.count}</td><td>${rowData.contests[0] || '—'}</td><td>${formatDrawDisplay(rowData.drawDate)}</td><td>${rowData.contests.join(', ')}</td>`;
        freqBody.appendChild(row);
    });
}

function renderCurrentContestNumberRanking(entries) {
    const contestValues = getSortedContestValues(entries);
    renderContestNumberRankingSection(entries, contestValues[0], {
        contestId: 'currentContestNumber',
        entriesId: 'currentContestEntries',
        picksId: 'currentContestPicks',
        tbodyId: 'currentContestNumberStatsBody',
        emptyMessage: 'No contest data found'
    });
}

function renderPreviousContestNumberRanking(entries) {
    const contestValues = getSortedContestValues(entries);
    renderContestNumberRankingSection(entries, contestValues[1], {
        contestId: 'previousContestNumber',
        entriesId: 'previousContestEntries',
        picksId: 'previousContestPicks',
        tbodyId: 'previousContestNumberStatsBody',
        emptyMessage: 'No previous contest data found'
    });
}

function getSortedContestValues(entries) {
    return Array.from(new Set(entries.map(e => (e.contest || '').trim()).filter(Boolean))).sort((a, b) => {
        const aNum = Number(a);
        const bNum = Number(b);
        const aIsNum = Number.isFinite(aNum);
        const bIsNum = Number.isFinite(bNum);
        if (aIsNum && bIsNum) return bNum - aNum;
        if (aIsNum) return -1;
        if (bIsNum) return 1;
        return b.localeCompare(a);
    });
}

function renderContestNumberRankingSection(entries, contestValue, options) {
    const tbody = document.getElementById(options.tbodyId);
    if (!tbody) return;

    const selectedPlatform = document.getElementById('currentContestPlatformFilter')?.value || '';

    if (!contestValue) {
        setText(options.contestId, '—');
        setText(options.entriesId, 0);
        setText(options.picksId, 0);
        tbody.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;">${options.emptyMessage}</td></tr>`;
        return;
    }

    const contestEntries = entries.filter(e => {
        if (String(e.contest || '').trim() !== contestValue) return false;
        if (selectedPlatform && e.platform !== selectedPlatform) return false;
        return true;
    });

    const frequency = {};
    for (let number = 1; number <= 80; number++) frequency[number] = 0;

    contestEntries.forEach(entry => {
        (entry.chosenNumbers || []).forEach(rawNumber => {
            const parsed = Number(rawNumber);
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 80) {
                frequency[parsed] += 1;
            }
        });
    });

    const ranking = Object.keys(frequency)
        .map(n => ({ number: Number(n), count: frequency[n] }))
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.number - b.number;
        });

    const totalPicks = ranking.reduce((sum, item) => sum + item.count, 0);

    setText(options.contestId, contestValue);
    setText(options.entriesId, contestEntries.length);
    setText(options.picksId, totalPicks);

    tbody.innerHTML = '';
    ranking.slice(0, 20).forEach((item, idx) => {
        const share = totalPicks > 0 ? ((item.count / totalPicks) * 100).toFixed(2) : '0.00';
        const row = document.createElement('tr');
        row.innerHTML = `<td>${idx + 1}</td><td><strong>${String(item.number).padStart(2, '0')}</strong></td><td>${item.count}</td><td>${share}%</td>`;
        tbody.appendChild(row);
    });
}

function renderContestWinnersBreakdown(entries, results, winners) {
    const container = document.getElementById('contestWinnersBreakdown');
    if (!container) return;
    container.innerHTML = '';
    results.forEach(res => {
        const contestEntries = entries.filter(e => e.contest === res.contest && e.drawDate === res.drawDate);
        const contestWinners = winners.filter(w => w.contest === res.contest && w.drawDate === res.drawDate);
        const counts = {1:0,2:0,3:0,4:0,5:0};
        contestWinners.forEach(w => counts[w.validation.matches]++);
        const card = document.createElement('div');
        card.className = 'breakdown-card';
        card.innerHTML = `<div class="breakdown-head"><div><p class="eyebrow">Contest ${res.contest}</p><h3>${res.drawDate}</h3></div><div class="pill">${contestEntries.length} entries</div></div><p class="muted">Winning numbers: ${res.winningNumbers.join(', ')}</p><div class="mini-grid"><div class="mini-stat"><span>5 hits</span><strong>${counts[5]}</strong></div><div class="mini-stat"><span>4 hits</span><strong>${counts[4]}</strong></div><div class="mini-stat"><span>3 hits</span><strong>${counts[3]}</strong></div><div class="mini-stat"><span>2 hits</span><strong>${counts[2]}</strong></div><div class="mini-stat"><span>1 hit</span><strong>${counts[1]}</strong></div></div>`;
        container.appendChild(card);
    });
}

function renderDashboardTopPlayers(entries, winners) {
    const tbody = document.getElementById('topPlayersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const stats = {};
    entries.forEach(e => { const p = e.whatsapp || 'N/A'; if (!stats[p]) stats[p] = { e: 0, w: 0, b: 0 }; stats[p].e++; });
    winners.forEach(w => { const p = w.whatsapp || 'N/A'; if (stats[p]) { stats[p].w++; if (w.validation.matches > stats[p].b) stats[p].b = w.validation.matches; } });
    Object.entries(stats).sort((a, b) => b[1].e - a[1].e).slice(0, 10).forEach(([p, s], idx) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${idx + 1}</td><td>${p}</td><td>${s.e}</td><td>${s.w}</td><td>${s.b > 0 ? s.b + ' hits' : '—'}</td>`;
        tbody.appendChild(row);
    });
}

function renderRecentEntries(entries) {
    const tbody = document.getElementById('recentEntriesBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    entries.slice(0, 12).forEach(e => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${e.registrationDate}<br><small style="color:#666;">${e.registrationTime}</small></td><td>${e.platform}</td><td>${e.gameId}</td><td>${e.whatsapp}</td><td><strong>${e.chosenNumbers.join(', ')}</strong></td><td>${formatDrawDisplay(e.displayDrawDate || e.drawDate)}</td><td><span class="pill">${e.contest}</span></td><td>${e.ticketNumber}</td><td>${statusBadge(e.status)}</td>`;
        tbody.appendChild(row);
    });
}

/**
 * ENTRIES PAGE LOGIC
 */
let entriesState = {
    currentPage: 1,
    perPage: 50,
    sortColumn: 'registrationDateTime',
    sortDirection: 'desc',
    filteredEntries: [],
    hasRechargeData: false,
    listenersAttached: false
};

async function initEntriesPage() {
    showLoading(true);
    hideError();
    try {
        await Promise.all([
            dataFetcher.fetchData(),
            rechargeValidator.fetchRechargeData()
        ]);
        const recharges = rechargeValidator.recharges || [];
        entriesState.hasRechargeData = recharges.length > 0;
        
        const rechargeStatus = document.getElementById('rechargeStatus');
        if (rechargeStatus) {
            rechargeStatus.textContent = entriesState.hasRechargeData ? `✅ ${recharges.length} recharges loaded` : '❌ No recharge data loaded';
            rechargeStatus.style.color = entriesState.hasRechargeData ? '#28a745' : '#dc3545';
        }

        updateRechargeLastUpdateTime();
        populateEntriesFilters();
        applyEntriesFiltersAndDisplay();
        setupEntriesListeners();
    } catch (error) {
        showError('Failed to load data: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function updateRechargeLastUpdateTime() {
    const lastUpdate = document.getElementById('rechargeLastUpdate');
    if (lastUpdate && rechargeValidator.lastFetchTime) lastUpdate.textContent = `Last updated: ${rechargeValidator.lastFetchTime.toLocaleString('pt-BR')}`;
}

function populateEntriesFilters() {
    const contests = dataFetcher.getUniqueContests();
    const dates = dataFetcher.getUniqueDrawDates();
    const contestSelect = document.getElementById('filterContest');
    if (contestSelect && contestSelect.options.length <= 1) {
        contests.forEach(c => { const o = document.createElement('option'); o.value = o.textContent = c; contestSelect.appendChild(o); });
    }
    const dateSelect = document.getElementById('filterDrawDate');
    if (dateSelect && dateSelect.options.length <= 1) {
        dates.forEach(d => { const o = document.createElement('option'); o.value = o.textContent = d; dateSelect.appendChild(o); });
    }
}

function applyEntriesFiltersAndDisplay() {
    const platform = document.getElementById('filterPlatform')?.value || '';
    const gameId = document.getElementById('filterGameId')?.value.toLowerCase() || '';
    const whatsapp = document.getElementById('filterWhatsApp')?.value.toLowerCase() || '';
    const contest = document.getElementById('filterContest')?.value || '';
    const drawDate = document.getElementById('filterDrawDate')?.value || '';
    const validity = document.getElementById('filterValidity')?.value || '';
    const cutoffFlag = document.getElementById('filterCutoff')?.value || '';
    
    let entries = dataFetcher.getAllEntries();
    console.log('🔍 Starting validation with', entries.length, 'entries and', rechargeValidator.recharges.length, 'recharges');
    console.log('📋 First entry gameId:', entries[0]?.gameId, 'platform:', entries[0]?.platform);
    console.log('💳 First recharge gameId:', rechargeValidator.recharges[0]?.gameId, 'platform:', rechargeValidator.recharges[0]?.platform);
    
    // Find newest entry date
    const newestEntry = entries.reduce((newest, e) => {
        return e.registrationDateTime > (newest?.registrationDateTime || '') ? e : newest;
    }, null);
    console.log('📅 NEWEST ENTRY DATE:', newestEntry?.registrationDateTime, 'from gameId:', newestEntry?.gameId);
    
    if (entriesState.hasRechargeData) {
        entries = rechargeValidator.validateEntries(entries);
        const validCount = entries.filter(e => e.validity === 'VALID').length;
        const invalidCount = entries.filter(e => e.validity === 'INVALID').length;
        console.log('✅ Valid:', validCount, '❌ Invalid:', invalidCount);
        if (invalidCount > 0) {
            console.log('🔴 Sample invalid entry:', JSON.stringify(entries.find(e => e.validity === 'INVALID'), null, 2));
        }
    } else {
        entries = entries.map(e => ({ ...e, validity: 'UNKNOWN', invalidReasonCode: 'NO_RECHARGE_DATA', boundRechargeId: null }));
    }
    
    entriesState.filteredEntries = entries.filter(e => {
        if (platform && e.platform !== platform) return false;
        if (gameId && !e.gameId.toLowerCase().includes(gameId)) return false;
        if (whatsapp && !e.whatsapp.toLowerCase().includes(whatsapp)) return false;
        if (contest && e.contest !== contest) return false;
        if (drawDate && e.drawDate !== normalizeDate(drawDate)) return false;
        if (validity && e.validity !== validity) return false;
        if (cutoffFlag === 'true' && !e.cutoffFlag) return false;
        return true;
    });
    
    sortEntries();
    entriesState.currentPage = 1;
    displayEntries();
    if (entriesState.hasRechargeData) updateValidationStats();
}

function updateValidationStats() {
    const stats = rechargeValidator.getStatistics();
    setText('validCount', stats.validTickets);
    setText('invalidCount', stats.invalidTickets);
    setText('cutoffCount', stats.cutoffShiftCases);
    setText('totalRecharges', stats.totalRecharges);
    const el = document.getElementById('validationStats');
    if (el) el.style.display = 'grid';
}

function sortEntries() {
    entriesState.filteredEntries.sort((a, b) => {
        let aVal = a[entriesState.sortColumn], bVal = b[entriesState.sortColumn];
        if (entriesState.sortColumn === 'chosenNumbers') { aVal = a.chosenNumbers.join(','); bVal = b.chosenNumbers.join(','); }
        if (entriesState.sortColumn === 'drawDate' || entriesState.sortColumn === 'registrationDateTime') { aVal = a[entriesState.sortColumn]; bVal = b[entriesState.sortColumn]; }
        if (aVal < bVal) return entriesState.sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return entriesState.sortDirection === 'asc' ? 1 : -1;
        return 0;
    });
}

function displayEntries() {
    const tbody = document.getElementById('entriesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const pageEntries = entriesState.filteredEntries.slice((entriesState.currentPage - 1) * entriesState.perPage, entriesState.currentPage * entriesState.perPage);
    
    pageEntries.forEach(e => {
        const row = tbody.insertRow();
        let valBadge = e.validity === 'VALID' ? '<span class="badge badge-validated">✅ VALID</span>' : (e.validity === 'INVALID' ? '<span class="badge badge-pending">❌ INVALID</span>' : '<span class="badge" style="background:#6c757d;color:white;">❓ UNKNOWN</span>');
        if (e.cutoffFlag) valBadge += ' <span class="badge badge-warning">⚠️ CUTOFF</span>';
        const recInfo = e.boundRechargeId ? `<div style="font-size:11px;"><strong>ID:</strong> ${e.boundRechargeId.substring(0,16)}...<br><strong>Time:</strong> ${e.boundRechargeTime}<br><strong>Amount:</strong> R$ ${e.boundRechargeAmount}</div>` : '<span style="color:#999;font-size:11px;">No recharge bound</span>';
        row.innerHTML = `<td>${valBadge}</td><td>${e.registrationDate}</td><td>${e.registrationTime}</td><td>${e.platform}</td><td>${e.gameId}</td><td>${e.whatsapp}</td><td><strong>${e.chosenNumbers.join(', ')}</strong></td><td>${formatDrawDisplay(e.displayDrawDate || e.drawDate)}</td><td><span class="badge badge-primary">${e.contest}</span></td><td>${e.ticketNumber}</td><td>${recInfo}</td><td><button class="btn-primary" style="padding:5px 10px;font-size:12px;" onclick='showDispute(${JSON.stringify(e).replace(/'/g, "&apos;")})'>🔍 Details</button></td>`;
    });
    updateEntriesPagination();
}

function showDispute(entry) {
    const modal = document.getElementById('disputeModal'), content = document.getElementById('disputeContent');
    if (!modal || !content) return;
    let valExp = entry.validity === 'VALID' ? `<div style="padding:15px;background:#d4edda;border-radius:8px;border-left:4px solid #28a745;margin-bottom:20px;"><h3 style="color:#155724;margin-bottom:10px;">✅ TICKET IS VALID</h3><p style="margin:0;">This is the first ticket created after recharge <strong>${entry.boundRechargeId}</strong>.</p></div>` : (entry.validity === 'INVALID' ? `<div style="padding:15px;background:#f8d7da;border-radius:8px;border-left:4px solid #dc3545;margin-bottom:20px;"><h3 style="color:#721c24;margin-bottom:10px;">❌ TICKET IS INVALID</h3><p style="margin:0;"><strong>Reason:</strong> ${rechargeValidator.getReasonCodeText(entry.invalidReasonCode)}</p>${entry.invalidReasonCode==='NO_RECHARGE_BEFORE_TICKET'?'<p style="margin-top:10px;font-size:13px;">💡 This ticket was created without a preceding recharge, or all recharges were already consumed by earlier tickets.</p>':''}</div>` : `<div style="padding:15px;background:#fff3cd;border-radius:8px;border-left:4px solid #ffc107;margin-bottom:20px;"><h3 style="color:#856404;margin-bottom:10px;">❓ VALIDITY UNKNOWN</h3><p style="margin:0;">Upload recharge data to validate this ticket.</p></div>`);
    const cutWarn = entry.cutoffFlag ? `<div style="padding:15px;background:#fff3cd;border-radius:8px;border-left:4px solid #ffc107;margin-bottom:20px;"><h3 style="color:#856404;margin-bottom:10px;">⚠️ CUTOFF TIME SHIFT DETECTED</h3><p style="margin:0;">Recharge happened before 20:00:00, but ticket was created after 20:00:01. This ticket belongs to tomorrow's draw.</p></div>` : '';
    content.innerHTML = `${valExp}${cutWarn}<h3 style="margin-bottom:15px;">📋 Ticket Information</h3><table style="width:100%;margin-bottom:20px;"><tr><td><strong>Game ID:</strong></td><td>${entry.gameId}</td></tr><tr><td><strong>Platform:</strong></td><td>${entry.platform}</td></tr><tr><td><strong>WhatsApp:</strong></td><td>${entry.whatsapp}</td></tr><tr><td><strong>Ticket #:</strong></td><td>${entry.ticketNumber}</td></tr><tr><td><strong>Registration Date:</strong></td><td>${entry.registrationDate}</td></tr><tr><td><strong>Registration Time:</strong></td><td>${entry.registrationTime}</td></tr><tr><td><strong>Contest:</strong></td><td>${entry.contest}</td></tr><tr><td><strong>Draw Date:</strong></td><td>${formatDrawDisplay(entry.displayDrawDate || entry.drawDate)}</td></tr><tr><td><strong>Chosen Numbers:</strong></td><td><strong>${entry.chosenNumbers.join(', ')}</strong></td></tr></table>${entry.boundRechargeId ? `<h3 style="margin-bottom:15px;">💳 Bound Recharge Information</h3><table style="width:100%;"><tr><td><strong>Recharge ID:</strong></td><td>${entry.boundRechargeId}</td></tr><tr><td><strong>Recharge Time:</strong></td><td>${entry.boundRechargeTime}</td></tr><tr><td><strong>Recharge Amount:</strong></td><td>R$ ${entry.boundRechargeAmount}</td></tr></table>` : '<p style="color:#999;font-style:italic;">No recharge data available for this ticket.</p>'}`;
    modal.classList.add('active');
}

function updateEntriesPagination() {
    const pi = document.getElementById('pageInfo'), pb = document.getElementById('prevPageBtn'), nb = document.getElementById('nextPageBtn');
    if (!pi || !pb || !nb) return;
    const tp = Math.ceil(entriesState.filteredEntries.length / entriesState.perPage);
    pi.textContent = `Page ${entriesState.currentPage} of ${tp} (${entriesState.filteredEntries.length} entries)`;
    pb.disabled = entriesState.currentPage === 1; nb.disabled = entriesState.currentPage >= tp;
}

function setupEntriesListeners() {
    if (entriesState.listenersAttached) return;
    document.getElementById('applyFiltersBtn')?.addEventListener('click', applyEntriesFiltersAndDisplay);
    document.getElementById('clearFiltersBtn')?.addEventListener('click', () => { ['filterGameId','filterWhatsApp','filterContest','filterDrawDate','filterValidity','filterCutoff'].forEach(id=>document.getElementById(id).value=''); applyEntriesFiltersAndDisplay(); });
    document.getElementById('exportBtn')?.addEventListener('click', () => {
        let csv = 'Validity,Registration Date,Registration Time,Platform,Game ID,WhatsApp,Chosen Numbers,Draw Date,Contest,Ticket #,Bound Recharge ID,Recharge Time,Recharge Amount,Invalid Reason,Cutoff Flag\n';
        entriesState.filteredEntries.forEach(e => csv += `"${e.validity}","${e.registrationDate}","${e.registrationTime}","${e.platform}","${e.gameId}","${e.whatsapp}","${e.chosenNumbers.join(', ')}","${e.drawDate}","${e.contest}","${e.ticketNumber}","${e.boundRechargeId||''}","${e.boundRechargeTime||''}","${e.boundRechargeAmount||''}","${e.invalidReasonCode||''}","${e.cutoffFlag?'YES':'NO'}"\n`);
        downloadCSV(csv, `entries_export_${new Date().toISOString()}`);
    });
    document.getElementById('prevPageBtn')?.addEventListener('click', () => { if(entriesState.currentPage>1){ entriesState.currentPage--; displayEntries(); } });
    document.getElementById('nextPageBtn')?.addEventListener('click', () => { if(entriesState.currentPage < Math.ceil(entriesState.filteredEntries.length/entriesState.perPage)){ entriesState.currentPage++; displayEntries(); } });
    document.getElementById('perPageSelect')?.addEventListener('change', (e) => { entriesState.perPage = parseInt(e.target.value); entriesState.currentPage = 1; displayEntries(); });
    document.querySelectorAll('#entriesTable th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.getAttribute('data-sort'); entriesState.sortDirection = entriesState.sortColumn === col && entriesState.sortDirection === 'asc' ? 'desc' : 'asc'; entriesState.sortColumn = col; applyEntriesFiltersAndDisplay(); }));
    document.getElementById('disputeModal')?.addEventListener('click', (e) => { if(e.target.id==='disputeModal') e.target.classList.remove('active'); });
    entriesState.listenersAttached = true;
}

/**
 * RESULTS PAGE LOGIC
 */
async function initResultsPage() {
    showLoading(true);
    hideError();
    try {
        await resultsFetcher.fetchResults();
        validator.setResults(resultsFetcher.getAllResults());
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        const res = validator.getAllResults();
        if (res.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum resultado encontrado</td></tr>'; return; }
        res.forEach(r => { const row = tbody.insertRow(); row.innerHTML = `<td><span class="badge badge-primary">${r.contest}</span></td><td>${formatDrawDisplay(r.displayDrawDate || r.drawDate)}</td><td><strong style="font-size:18px;color:#1e3c72;">${r.winningNumbers.join(', ')}</strong></td><td>${formatTicketDate(r.savedAt)}</td><td><span class="badge badge-validated">RESULT Sheet</span></td>`; });
    } catch (error) {
        showError('Failed to load data: ' + error.message);
    } finally {
        showLoading(false);
    }
}

/**
 * WINNERS PAGE LOGIC
 */
let winnersState = { allWinners: [], filteredWinners: [], listenersAttached: false };
async function initWinnersPage() {
    showLoading(true);
    hideError();
    try {
        await Promise.all([
            dataFetcher.fetchData(),
            resultsFetcher.fetchResults(),
            rechargeValidator.fetchRechargeData()
        ]);
        validator.setResults(resultsFetcher.getAllResults());
        populateWinnersFilters();
        validateAndDisplayWinners();
        renderTicketCreatorsComparison();
        setupWinnersListeners();
    } catch (error) {
        showError('Failed to load data: ' + error.message);
    } finally {
        showLoading(false);
    }
}
function populateWinnersFilters() {
    const c = dataFetcher.getUniqueContests(), d = dataFetcher.getUniqueDrawDates(), cs = document.getElementById('winnersFilterContest'), ds = document.getElementById('winnersFilterDrawDate');
    if (cs && cs.options.length <= 1) c.forEach(v => { const o = document.createElement('option'); o.value = o.textContent = v; cs.appendChild(o); });
    if (ds && ds.options.length <= 1) d.forEach(v => { const o = document.createElement('option'); o.value = o.textContent = v; ds.appendChild(o); });
}
function validateAndDisplayWinners() {
    const allEntries = dataFetcher.getAllEntries();
    const results = validator.getAllResults();
    if (results.length === 0) { 
        setText('sum5',0);setText('sum4',0);setText('sum3',0);setText('sum2',0);setText('sum1',0);setText('sumTotal',0); 
        return; 
    }
    
    // Filter by csvStatus (manual review after cutoff)
    // csvStatus is manually updated in Google Sheet column K after review
    const validEntries = allEntries
        .filter(e => e.csvStatus === 'VALID' || e.csvStatus === 'VÁLIDO')
        .map(e => ({ ...e, status: 'VALID' }));  // Copy to status for validator
    
    console.log('🏆 Winner calc: Total entries:', allEntries.length, 'Valid entries (csvStatus=VALID):', validEntries.length);
    
    // Get winners from manually approved entries only
    winnersState.allWinners = validator.getWinners(validEntries);
    
    // Calculate prizes: R$900 per platform per contest
    calculateWinnerPrizes(winnersState.allWinners);
    
    applyWinnersFilters();
}

function calculateWinnerPrizes(winners) {
    // ⚠️ CRITICAL: Group by PLATFORM + CONTEST + DRAWDATE
    // Prize pool R$900 per platform per contest
    const groups = {};
    winners.forEach(w => {
        const key = `${w.platform}_${w.contest}_${w.drawDate}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(w);
    });
    
    // Assign prizes: R$900 / count per group
    Object.keys(groups).forEach(key => {
        const count = groups[key].length;
        const prizePerWinner = 900 / count;
        // Prize pool R$900 per platform per contest
        console.log(`Prize calculated: R$${prizePerWinner.toFixed(2)}`);
        groups[key].forEach(w => {
            w.prize = prizePerWinner;
        });
    });
    
    console.log('💰 Prize groups:', Object.keys(groups).map(k => `${k}: ${groups[k].length} winners, R$${(900/groups[k].length).toFixed(2)} each`));
}
function applyWinnersFilters() {
    const platform = document.getElementById('winnersFilterPlatform')?.value || '';
    const c = document.getElementById('winnersFilterContest')?.value || '', d = document.getElementById('winnersFilterDrawDate')?.value || '', pt = document.getElementById('filterPrizeTier')?.value || '', w = document.getElementById('winnersFilterWhatsApp')?.value.toLowerCase() || '';
    winnersState.filteredWinners = winnersState.allWinners.filter(win => { if(platform && win.platform!==platform) return false; if(c && win.contest!==c) return false; if(d && win.drawDate!==normalizeDate(d)) return false; if(pt && win.validation.matches!==parseInt(pt,10)) return false; if(w && !win.whatsapp.toLowerCase().includes(w)) return false; return true; });
    displayWinnersList(); updateWinnersSummary(winnersState.filteredWinners);
}
function displayWinnersList() {
    const tbody = document.getElementById('winnersTableBody'); if (!tbody) return; tbody.innerHTML = '';
    winnersState.filteredWinners.forEach(win => {
        const v = win.validation, row = tbody.insertRow();
        let pe = '', pbc = ''; switch(v.matches){ case 5:pe='🏆';pbc='badge-gold';break; case 4:pe='🥈';pbc='badge-silver';break; case 3:pe='🥉';pbc='badge-bronze';break; case 2:pe='🎯';pbc='badge-green';break; case 1:pe='✨';pbc='badge-pending';break; }
        const ch = win.chosenNumbers.map(n => v.matchedNumbers.includes(n) ? `<span style="background:#4CAF50;color:white;padding:2px 6px;border-radius:4px;font-weight:bold;">${n}</span>` : `<span>${n}</span>`).join(', ');
        const ma = v.matchedNumbers.map(n => `<span style="background:#FFD700;color:#333;padding:2px 6px;border-radius:4px;font-weight:bold;">${n}</span>`).join(', ');
        const platformBadge = win.platform === 'POPLUZ' ? '<span class="badge" style="background:#9C27B0;color:white;">POPLUZ</span>' : '<span class="badge" style="background:#FF5722;color:white;">POPN1</span>';
        row.innerHTML = `<td><span class="badge ${pbc}">${pe} ${v.prizeTier.tier}</span></td><td><strong style="font-size:20px;color:#1e3c72;">${v.matches}</strong></td><td>${win.registrationDate}<br><small style="color:#666;">${win.registrationTime}</small></td><td>${platformBadge}</td><td>${win.gameId}</td><td><strong>${win.whatsapp}</strong></td><td style="font-size:14px;">${ch}</td><td style="font-size:14px;"><strong>${v.winningNumbers.join(', ')} </strong></td><td style="font-size:14px;">${ma}</td><td>${formatDrawDisplay(win.displayDrawDate || win.drawDate)}</td><td><span class="badge badge-primary">${win.contest}</span></td><td>${win.ticketNumber}<br><small>R$ ${win.prize?win.prize.toFixed(2):'0.00'}</small></td>`;
    });
}
function updateWinnersSummary(l) { const c = {1:0,2:0,3:0,4:0,5:0}; l.forEach(w => c[w.validation.matches]++); setText('sum5',c[5]); setText('sum4',c[4]); setText('sum3',c[3]); setText('sum2',c[2]); setText('sum1',c[1]); setText('sumTotal',l.length); }
function renderTicketCreatorsComparison() {
    const e = dataFetcher.getAllEntries(), b = {}; e.forEach(en => { const k = dateKeyFromString(en.registrationDateTime); if(k){ if(!b[k]) b[k]=new Set(); b[k].add(`${en.platform}_${en.gameId}`); } });
    const tISO = new Date().toISOString().slice(0,10), yISO = new Date(Date.now()-86400000).toISOString().slice(0,10), tc = b[tISO]?b[tISO].size:0, yc = b[yISO]?b[yISO].size:0, mc = Math.max(tc,yc,1);
    const tb = document.getElementById('todayBarFill'), yb = document.getElementById('yesterdayBarFill'); if(tb) tb.style.height = `${(tc/mc*100).toFixed(0)}%`; if(yb) yb.style.height = `${(yc/mc*100).toFixed(0)}%`;
    setText('todayCount',tc); setText('yesterdayCount',yc);
}
function setupWinnersListeners() {
    if (winnersState.listenersAttached) return;
    document.getElementById('validateBtn')?.addEventListener('click', validateAndDisplayWinners);
    document.getElementById('exportWinnersBtn')?.addEventListener('click', () => {
        if(winnersState.filteredWinners.length===0){alert('No winners to export');return;}
        let csv = 'Prize Tier,Matches,Registration Date/Time,Platform,Game ID,WhatsApp,Chosen Numbers,Winning Numbers,Matched Numbers,Draw Date,Contest,Ticket #,Prize Amount\n';
        winnersState.filteredWinners.forEach(w => { const v=w.validation; csv+=`"${v.prizeTier.tier}","${v.matches}","${w.registrationDate} ${w.registrationTime}","${w.platform}","${w.gameId}","${w.whatsapp}","${w.chosenNumbers.join(', ')}","${v.winningNumbers.join(', ')}","${v.matchedNumbers.join(', ')}","${w.drawDate}","${w.contest}","${w.ticketNumber}","R$ ${w.prize?w.prize.toFixed(2):'0.00'}"\n`; });
        downloadCSV(csv, `winners_export_${new Date().toISOString()}`);
    });
    document.getElementById('winnersClearFiltersBtn')?.addEventListener('click', () => { ['winnersFilterPlatform','winnersFilterContest','winnersFilterDrawDate','filterPrizeTier','winnersFilterWhatsApp'].forEach(id=>document.getElementById(id).value=''); applyWinnersFilters(); });
    ['winnersFilterPlatform','winnersFilterContest','winnersFilterDrawDate','filterPrizeTier'].forEach(id=>document.getElementById(id)?.addEventListener('change',applyWinnersFilters));
    document.getElementById('winnersFilterWhatsApp')?.addEventListener('input',applyWinnersFilters);
    winnersState.listenersAttached = true;
}

/**
 * UTILS
 */
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function dateKeyFromString(s) { 
    if (!s) return null; 
    const trimmed = s.trim();
    const dm = trimmed.match(/^([0-3]?\d)\/([0-1]?\d)\/(\d{4})(?:\s+[0-2]?\d:[0-5]\d(?::[0-5]\d)?)?$/);
    if (dm) {
        const d = dm[1].padStart(2, '0');
        const m = dm[2].padStart(2, '0');
        const y = dm[3];
        return `${y}-${m}-${d}`;
    }
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ].*)?$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return null; 
}

function formatTicketDate(raw) {
    if (!raw) return '';
    const date = DateUtils.parseISO(raw);
    return DateUtils.formatTimestamp(date);
}

function formatDrawDisplay(raw) {
    // raw is already displayDrawDate, human readable
    return raw || '';
}

function statusBadge(s) { const n = (s||'').toUpperCase(); if (n==='VALIDADO'||n==='VALIDATED') return '<span class="badge badge-validated">Validated</span>'; if (n==='PENDENTE'||n==='PENDING') return '<span class="badge badge-pending">Pending</span>'; return `<span class="badge badge-silver">${s||'—'}</span>`; }
function showLoading(show, message = 'Loading data...', progress = null) {
    const el = document.getElementById('loadingIndicator');
    const textEl = document.getElementById('loadingText');
    const progressEl = document.getElementById('loadingProgress');
    const progressBarEl = document.getElementById('progressBar');

    if (el) {
        el.style.display = show ? 'flex' : 'none';
        if (textEl) textEl.textContent = message;
        if (progressEl) progressEl.style.display = progress !== null ? 'block' : 'none';
        if (progressBarEl && progress !== null) progressBarEl.style.width = progress + '%';
    }
}

function showSuccess(message) {
    const el = document.getElementById('successMessage');
    if (el) {
        el.textContent = message;
        el.style.display = 'block';
        setTimeout(() => el.style.display = 'none', 3000);
    }
}

function hideError() {
    const el = document.getElementById('errorMessage');
    if (el) el.style.display = 'none';
}

function showError(message) {
    const el = document.getElementById('errorMessage');
    if (el) {
        el.textContent = message;
        el.style.display = 'block';
    }
}
function hideError() { const el = document.getElementById('errorMessage'); if(el) el.style.display = 'none'; }
function showError(m) { const el = document.getElementById('errorMessage'); if(el){ el.textContent = m; el.style.display = 'block'; } }
function updateLastUpdateTime() {
    const statusEl = document.getElementById('statusIndicator');
    const textEl = document.getElementById('lastUpdateText');
    const footerEl = document.getElementById('lastUpdate');

    if (dataFetcher.lastFetchTime) {
        const timeStr = dataFetcher.lastFetchTime.toLocaleString('pt-BR');
        if (statusEl) statusEl.textContent = '✅';
        if (textEl) textEl.textContent = 'Updated: ' + timeStr;
        if (footerEl) footerEl.textContent = timeStr;
    } else {
        if (statusEl) statusEl.textContent = '⏳';
        if (textEl) textEl.textContent = 'Loading...';
        if (footerEl) footerEl.textContent = 'Never';
    }
}
function setAccountBanner() { const el = document.getElementById('accountBanner'); if(!el || typeof getSession !== 'function') return; const s = getSession(); el.textContent = s && s.account ? `Logged in as: ${s.account}` : 'Logged in as: (session missing)'; }
function downloadCSV(c, f) { const b = new Blob([c],{type:'text/csv'}), u = window.URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = f+'.csv'; a.click(); }

function setupAutoRefresh() {
    setInterval(async () => {
        try {
            console.log('🔄 Auto-refreshing data...');
            await Promise.all([dataFetcher.fetchData(), resultsFetcher.fetchResults(), rechargeValidator.fetchRechargeData()]);
            validator.setResults(resultsFetcher.getAllResults());
            updateDashboard();
            updateLastUpdateTime();
            console.log('✅ Auto-refresh completed');
        } catch (e) {
            console.error('❌ Auto-refresh failed:', e);
            // Don't show error popup for auto-refresh failures to avoid annoying users
        }
    }, 60000); // Refresh every 60 seconds
}

function initializePage(pageId) {
    switch (pageId) {
        case 'dashboard': updateDashboard(); break;
        case 'entries': initEntriesPage(); break;
        case 'results': initResultsPage(); break;
        case 'winners': initWinnersPage(); break;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
    setupAutoRefresh();
    
    // Add listener for chart metric change
    document.getElementById('chartMetricSelect')?.addEventListener('change', () => {
        const entries = dataFetcher.getAllEntries();
        const recharges = rechargeValidator.recharges || [];
        const metric = document.getElementById('chartMetricSelect').value;
        renderEntriesVolumeChart(entries, recharges, metric);
    });

    document.getElementById('currentContestPlatformFilter')?.addEventListener('change', () => {
        const entries = dataFetcher.getAllEntries();
        renderCurrentContestNumberRanking(entries);
        renderPreviousContestNumberRanking(entries);
    });

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
        const originalText = refreshBtn.textContent;
        refreshBtn.textContent = '🔄 Refreshing...';
        refreshBtn.disabled = true;

        try {
            await initDashboard();
            const activeLink = document.querySelector('.nav-link.active');
            const activePage = activeLink ? activeLink.getAttribute('data-page') : 'dashboard';
            initializePage(activePage);
            showSuccess('🔄 Dashboard refreshed successfully!');
        } catch (error) {
            showError('❌ Refresh failed: ' + error.message);
        } finally {
            refreshBtn.textContent = originalText;
            refreshBtn.disabled = false;
        }
    });
});

function parseDate(dateStr) {
    // Parse DD/MM/YYYY
    const [d, m, y] = dateStr.split('/');
    return new Date(y, m - 1, d);
}

function normalizeDate(dateStr) {
    if (!dateStr) return '';
    // If already YYYY-MM-DD, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // Parse human readable "2 January 2026"
    const humanMatch = dateStr.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
    if (humanMatch) {
        const day = parseInt(humanMatch[1], 10);
        const monthName = humanMatch[2];
        const year = parseInt(humanMatch[3], 10);
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(monthName);
        if (monthIndex !== -1) {
            const date = new Date(year, monthIndex, day);
            return DateUtils.normalizeToYYYYMMDD(date);
        }
    }
    // Fallback for DD/MM/YYYY
    if (dateStr.includes('/')) {
        const [d, m, y] = dateStr.split('/');
        if (d && m && y) {
            return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
    }
    return dateStr;
}
