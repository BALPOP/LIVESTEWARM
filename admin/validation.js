class RechargeValidator {
  constructor() {
    this.recharges = [];
    this.validatedEntries = [];
    this.noDrawHolidays = ['12-25', '01-01'];
    this.rechargeDataComplete = false;
  }

  setRecharges(recharges, options = {}) {
    this.recharges = recharges || [];
    this.rechargeDataComplete = !!options.isComplete;
  }

  isNoDrawDay(dateObj) {
    const f = AdminUtils.brtFields(dateObj);
    if (f.weekday === 0) return true;
    const m = String(f.month + 1).padStart(2, '0');
    const d = String(f.day).padStart(2, '0');
    return this.noDrawHolidays.includes(`${m}-${d}`);
  }

  getCutoffTime(dateObj) {
    const f = AdminUtils.brtFields(dateObj);
    const m = f.month + 1;
    const d = f.day;
    if ((m === 12 && d === 24) || (m === 12 && d === 31)) {
      return { hour: 16, minute: 0, second: 0 };
    }
    return { hour: 20, minute: 0, second: 0 };
  }

  buildCutoffDateTime(dateObj) {
    const f = AdminUtils.brtFields(dateObj);
    const { hour, minute, second } = this.getCutoffTime(dateObj);
    return AdminUtils.makeDateFromBrt(f.year, f.month, f.day, hour, minute, second);
  }

  ticketDrawDay(ticketTime) {
    const f = AdminUtils.brtFields(ticketTime);
    let probe = AdminUtils.makeDateFromBrt(f.year, f.month, f.day, 0, 0, 0);
    for (let i = 0; i < 60; i++) {
      if (!this.isNoDrawDay(probe)) {
        const cutoff = this.buildCutoffDateTime(probe);
        if (cutoff >= ticketTime) {
          return { day: probe, cutoff };
        }
      }
      probe = new Date(probe.getTime() + 24 * 60 * 60 * 1000);
    }
    return null;
  }

  computeEligibleDraws(rechargeTimeObj) {
    if (!rechargeTimeObj) return null;

    const f = AdminUtils.brtFields(rechargeTimeObj);
    let eligible1Day = AdminUtils.makeDateFromBrt(f.year, f.month, f.day, 0, 0, 0);
    for (let i = 0; i < 60 && this.isNoDrawDay(eligible1Day); i++) {
      eligible1Day = new Date(eligible1Day.getTime() + 24 * 60 * 60 * 1000);
    }
    const eligible1Cutoff = this.buildCutoffDateTime(eligible1Day);

    let eligible2Day = new Date(eligible1Day.getTime() + 24 * 60 * 60 * 1000);
    for (let i = 0; i < 60 && this.isNoDrawDay(eligible2Day); i++) {
      eligible2Day = new Date(eligible2Day.getTime() + 24 * 60 * 60 * 1000);
    }
    const eligible2Cutoff = this.buildCutoffDateTime(eligible2Day);

    return {
      eligible1: { day: eligible1Day, cutoff: eligible1Cutoff },
      eligible2: { day: eligible2Day, cutoff: eligible2Cutoff }
    };
  }

  validateEntries(entries) {
    if (!this.recharges.length) {
      return entries.map(entry => ({
        ...entry,
        validity: 'PENDING',
        invalidReasonCode: 'NO_RECHARGE_DATA',
        boundRechargeId: null,
        cutoffFlag: false
      }));
    }

    const rechargesByKey = {};
    this.recharges.forEach(r => {
      const key = `${r.platform}_${r.gameId}`;
      if (!rechargesByKey[key]) rechargesByKey[key] = [];
      rechargesByKey[key].push(r);
    });

    Object.values(rechargesByKey).forEach(list =>
      list.sort((a, b) => (a.rechargeTimeObj?.getTime() || 0) - (b.rechargeTimeObj?.getTime() || 0))
    );

    const entriesByKey = {};
    entries.forEach(e => {
      const key = `${e.platform}_${e.gameId}`;
      if (!entriesByKey[key]) entriesByKey[key] = [];
      e.ticketTimeObj = e.ticketTimeObj || AdminUtils.parseISO(e.createdAtRaw);
      entriesByKey[key].push(e);
    });

    Object.values(entriesByKey).forEach(list =>
      list.sort((a, b) => (a.ticketTimeObj?.getTime() || 0) - (b.ticketTimeObj?.getTime() || 0))
    );

    const validated = [];

    Object.keys(entriesByKey).forEach(key => {
      const tickets = entriesByKey[key];
      const userRecharges = rechargesByKey[key] || [];
      const consumed = new Set();

      const rechargeWindows = userRecharges.map(r => ({
        recharge: r,
        windows: this.computeEligibleDraws(r.rechargeTimeObj)
      }));

      tickets.forEach(ticket => {
        const persistedStatus = String(ticket.status || ticket.csvStatus || '').trim().toUpperCase();
        if (persistedStatus) {
          if (['VALID', 'VALIDADO', 'VALIDATED', 'VALIDO', 'VÁLIDO'].includes(persistedStatus)) {
            const bound = ticket.boundRechargeIdRaw ? {
              rechargeId: ticket.boundRechargeIdRaw,
              rechargeTime: null,
              rechargeAmount: null
            } : null;
            validated.push(this._result(ticket, 'VALID', null, bound, false));
            return;
          }

          if (['INVALID', 'INVÁLIDO', 'REJECTED', 'CANCELLED'].includes(persistedStatus)) {
            validated.push(this._result(ticket, 'INVALID', 'STATUS_INVALID_SYNCED', null, false));
            return;
          }

          if (['PENDING', 'GENERATED', 'ALL PENDING'].includes(persistedStatus)) {
            validated.push(this._result(ticket, 'PENDING', ticket.syncReasonRaw || 'STATUS_PENDING_SYNC', null, false));
            return;
          }
        }

        let validity = 'INVALID';
        let reason = 'NO_ELIGIBLE_RECHARGE';
        let bound = null;
        let cutoffFlag = false;

        if (!ticket.ticketTimeObj) {
          validated.push(this._result(ticket, 'INVALID', 'INVALID_TICKET_TIME', null, false));
          return;
        }

        const t = ticket.ticketTimeObj;
        const drawInfo = this.ticketDrawDay(t);
        if (!drawInfo) {
          validated.push(this._result(ticket, 'INVALID', 'NO_ELIGIBLE_RECHARGE', null, false));
          return;
        }
        const ticketDrawDay = drawInfo.day;

        const hasRechargeBefore = userRecharges.some(r => r.rechargeTimeObj && t > r.rechargeTimeObj);
        let foundMatch = false;
        let expiredCandidate = false;
        let consumedCandidate = false;

        for (const { recharge, windows } of rechargeWindows) {
          if (!windows || !recharge.rechargeTimeObj) continue;
          const rt = recharge.rechargeTimeObj;

          const sameDayBrt = (a, b) => {
            const fa = AdminUtils.brtFields(a);
            const fb = AdminUtils.brtFields(b);
            return fa.year === fb.year && fa.month === fb.month && fa.day === fb.day;
          };

          const isEligible1 = sameDayBrt(ticketDrawDay, windows.eligible1.day);
          const isEligible2 = sameDayBrt(ticketDrawDay, windows.eligible2.day);

          if (t <= rt) continue;

          if (!(isEligible1 || isEligible2)) {
            if (ticketDrawDay > windows.eligible2.day) expiredCandidate = true;
            continue;
          }

          if (consumed.has(recharge.rechargeId)) {
            consumedCandidate = true;
            continue;
          }

          foundMatch = true;
          bound = recharge;
          validity = recharge.rechargeStatus === 'VALID' ? 'VALID' : 'INVALID';
          reason = recharge.rechargeStatus === 'VALID' ? null : 'RECHARGE_INVALIDATED';
          consumed.add(recharge.rechargeId);
          if (isEligible2) cutoffFlag = true;
          break;
        }

        if (!foundMatch) {
          if (!hasRechargeBefore) {
            if (!this.rechargeDataComplete) {
              validity = 'PENDING';
              reason = 'RECHARGE_DATA_PARTIAL';
            } else {
              reason = 'INVALID_TICKET_BEFORE_RECHARGE';
            }
          } else if (expiredCandidate) {
            reason = 'INVALID_RECHARGE_WINDOW_EXPIRED';
          } else if (consumedCandidate) {
            reason = 'INVALID_NOT_FIRST_TICKET_AFTER_RECHARGE';
          } else {
            if (!this.rechargeDataComplete) {
              validity = 'PENDING';
              reason = 'RECHARGE_DATA_PARTIAL';
            } else {
              reason = 'NO_ELIGIBLE_RECHARGE';
            }
          }
        }

        validated.push(this._result(ticket, validity, reason, bound, cutoffFlag));
      });
    });

    this.validatedEntries = validated;
    return validated;
  }

  _result(ticket, validity, reason, bound, cutoffFlag) {
    return {
      ...ticket,
      validity,
      invalidReasonCode: reason,
      boundRechargeId: bound?.rechargeId || null,
      boundRechargeTime: bound?.rechargeTime || null,
      boundRechargeAmount: bound?.rechargeAmount || null,
      cutoffFlag
    };
  }

  getStatistics() {
    const validCount = this.validatedEntries.filter(e => e.validity === 'VALID').length;
    const invalidCount = this.validatedEntries.filter(e => e.validity === 'INVALID').length;
    const unknownCount = this.validatedEntries.filter(e => e.validity === 'UNKNOWN').length;
    const cutoffFlagCount = this.validatedEntries.filter(e => e.cutoffFlag).length;

    const reasonCounts = {};
    this.validatedEntries.forEach(e => {
      if (e.invalidReasonCode) {
        reasonCounts[e.invalidReasonCode] = (reasonCounts[e.invalidReasonCode] || 0) + 1;
      }
    });

    return {
      totalRecharges: this.recharges.length,
      validTickets: validCount,
      invalidTickets: invalidCount,
      unknownTickets: unknownCount,
      cutoffShiftCases: cutoffFlagCount,
      invalidReasons: reasonCounts
    };
  }
}

class LotteryValidator {
  constructor() {
    this.contestResults = {};
    this.allowedValidStatuses = ['VALID', 'VALIDATED', 'VALIDADO', 'VALIDO', 'VÁLIDO'];
    this.blockedPendingStatuses = ['GENERATED', 'PENDING', 'ALL PENDING'];
  }

  setResults(results) {
    this.contestResults = {};
    results.forEach(r => {
      const key = `${r.contest}_${r.drawDate}`;
      this.contestResults[key] = {
        contest: r.contest,
        drawDate: r.drawDate,
        winningNumbers: r.winningNumbers
      };
    });
  }

  getContestResult(contest, drawDate) {
    return this.contestResults[`${contest}_${drawDate}`];
  }

  matchNumbers(chosenNumbers, winningNumbers) {
    const matches = chosenNumbers.filter(num => winningNumbers.includes(num));
    return { count: matches.length, matchedNumbers: matches };
  }

  getPrizeTier(matchCount) {
    switch (matchCount) {
      case 5: return { tier: 'JACKPOT', priority: 1 };
      case 4: return { tier: '4 NUMBERS', priority: 2 };
      case 3: return { tier: '3 NUMBERS', priority: 3 };
      case 2: return { tier: '2 NUMBERS', priority: 4 };
      case 1: return { tier: '1 NUMBER', priority: 5 };
      default: return { tier: 'NO PRIZE', priority: 6 };
    }
  }

  validateEntry(entry) {
    if (entry.validity) {
      const validity = entry.validity.toString().trim().toUpperCase();
      if (validity === 'INVALID') {
        return { validated: false, message: entry.invalidReasonCode || 'Recharge invalid', gate: 'RECHARGE_INVALID', validity };
      }
      if (validity !== 'VALID') {
        return { validated: false, message: 'Ticket validity unknown', gate: 'VALIDITY_UNKNOWN', validity };
      }
    }

    const statusRaw = entry.status || entry.csvStatus || '';
    const status = statusRaw.toString().trim().toUpperCase();

    if (status === 'INVALID' || status === 'INVÁLIDO') {
      return { validated: false, message: 'Ticket status invalid', gate: 'STATUS_INVALID', status };
    }

    if (this.blockedPendingStatuses.includes(status) || (status && !this.allowedValidStatuses.includes(status))) {
      return { validated: false, message: 'Ticket not validated', gate: 'STATUS_NOT_VALIDATED', status };
    }

    const result = this.getContestResult(entry.contest, entry.drawDate);
    if (!result) {
      return { validated: false, message: 'No winning numbers for this contest' };
    }

    const matchResult = this.matchNumbers(entry.chosenNumbers, result.winningNumbers);
    const prizeTier = this.getPrizeTier(matchResult.count);

    return {
      validated: true,
      matches: matchResult.count,
      matchedNumbers: matchResult.matchedNumbers,
      prizeTier,
      winningNumbers: result.winningNumbers
    };
  }

  getWinners(entries) {
    const eligible = entries.filter(e => {
      const status = (e.status || '').toString().trim().toUpperCase();
      return this.allowedValidStatuses.includes(status);
    });

    const grouped = {};
    eligible.forEach(entry => {
      const key = `${entry.platform}_${entry.contest}_${entry.drawDate}`;
      if (!grouped[key]) grouped[key] = [];
      const validation = this.validateEntry(entry);
      grouped[key].push({ ...entry, validation });
    });

    const winners = [];
    Object.values(grouped).forEach(group => {
      const highest = group.reduce((max, g) => g.validation?.validated ? Math.max(max, g.validation.matches) : max, 0);
      if (highest === 0) return;
      group.filter(g => g.validation?.validated && g.validation.matches === highest).forEach(w => winners.push(w));
    });

    return winners;
  }

  getApprovedWinners(entries) {
    const approved = entries.filter(e => {
      const status = (e.csvStatus || e.status || '').toString().trim().toUpperCase();
      return ['VALID', 'VALIDADO', 'VALIDATED', 'VALIDO', 'VÁLIDO'].includes(status);
    }).map(e => ({ ...e, status: 'VALID' }));

    return this.getWinners(approved);
  }
}

window.RechargeValidator = RechargeValidator;
window.LotteryValidator = LotteryValidator;
