// --- LOGIC ---
function getLiquidityBreakdown() {
    let totalLiquid = 0;
    const items = [];

    items.push({
        label: 'Surplus (Unallocated)',
        amount: state.surplus
    });
    totalLiquid += state.surplus;

    ensureWeeklyState();

    state.strategy.forEach(sec => {
        sec.items.forEach(item => {
            if(item.label === 'Food Base' || item.label === 'Weekly Misc') return;

            const currentVal = state.balances[item.label] !== undefined ? state.balances[item.label] : item.amount;
            items.push({ label: item.label, amount: currentVal });
            totalLiquid += currentVal;
        });
    });

    const weeklyAmt = getWeeklyConfigAmount();
    const currentWeekBalance = Math.max(0, state.weekly.balance || 0);
    const remainingWeeks = Math.max(0, WEEKLY_MAX_WEEKS - (state.weekly.week || 1));
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

    return { totalLiquid, items };
}
