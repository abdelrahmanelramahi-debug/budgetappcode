// --- LOGIC ---
function getSavingsTotal() {
    const buckets = state.accounts?.savingsBuckets;
    if (!buckets) return state.accounts?.buckets?.['General Savings'] ?? 0;
    return Object.values(buckets).reduce((sum, val) => sum + (val || 0), 0);
}

function getItemBalance(label, fallback = 0) {
    if (label === 'General Savings') {
        return getSavingsTotal();
    }
    if (isAccountLabel(label)) {
        return state.accounts?.buckets?.[label] ?? fallback;
    }
    return state.balances?.[label] !== undefined ? state.balances[label] : fallback;
}

function getLiquidityBreakdown() {
    let totalLiquid = 0;
    const items = [];

    items.push({
        label: 'Surplus (Unallocated)',
        amount: state.accounts?.surplus || 0
    });
    totalLiquid += state.accounts?.surplus || 0;

    ensureWeeklyState();

    state.categories.forEach(sec => {
        sec.items.forEach(item => {
            if(item.label === 'Food Base' || item.label === 'Weekly Misc') return;

            if (item.label === 'General Savings' && state.accounts?.savingsBuckets) {
                Object.entries(state.accounts.savingsBuckets).forEach(([key, amount]) => {
                    items.push({ label: `Savings: ${key}`, amount: amount });
                    totalLiquid += amount;
                });
                return;
            }

            const currentVal = getItemBalance(item.label, item.amount);
            items.push({ label: item.label, amount: currentVal });
            totalLiquid += currentVal;
        });
    });

    const weeklyAmt = getWeeklyConfigAmount();
    const currentWeekBalance = Math.max(0, state.accounts.weekly.balance || 0);
    const remainingWeeks = Math.max(0, WEEKLY_MAX_WEEKS - (state.accounts.weekly.week || 1));
    const outstandingWeeks = remainingWeeks * weeklyAmt;

    items.push({ label: 'Weekly (Current Week)', amount: currentWeekBalance });
    totalLiquid += currentWeekBalance;

    if (outstandingWeeks > 0) {
        items.push({ label: 'Weekly (Outstanding)', amount: outstandingWeeks, meta: `${remainingWeeks} week${remainingWeeks === 1 ? '' : 's'}` });
        totalLiquid += outstandingWeeks;
    }

    // Food Remainder calculation logic
    const { daysLeft, remainder } = getFoodRemainderInfo();
    items.push({ label: 'Food Remainder', amount: remainder, meta: `${daysLeft} days` });
    totalLiquid += remainder;

    // Food Buffer (locked funds)
    const locked = state.food?.lockedAmount || 0;
    if (locked > 0) {
        items.push({ label: 'Food Buffer', amount: locked, meta: 'Locked' });
        totalLiquid += locked;
    }

    return { totalLiquid, items };
}

function getCurrentBalance() {
    return getLiquidityBreakdown().totalLiquid;
}
