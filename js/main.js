// INIT
window.onload = function() {
    loadState();
    ensureSystemSavings();
    ensureCoreItems();

    // Check for un-migrated savings or zero-balance legacy defaults
    const sys = state.categories.find(s=>s.id==='sys_savings');
    if(sys) {
        const item = sys.items.find(i=>i.label==='General Savings');
        // Force update if it's auto-calculated OR if it is sitting at the old default of 0
        if(item && (item.isAutoCalculated || item.amount === 0)) {
            item.isAutoCalculated = false;
            item.amount = 1457;
            // Also update the running balance if it's 0 or undefined
            if(state.accounts?.buckets?.['General Savings'] === undefined || state.accounts.buckets['General Savings'] === 0) {
                state.accounts.buckets['General Savings'] = 1457;
            }
        }
        const payables = sys.items.find(i=>i.label==='Payables');
        if(!payables) {
            sys.items.push({ label: 'Payables', amount: 0, isAutoCalculated: false });
        }
        if(state.accounts?.buckets?.['Payables'] === undefined) {
            state.accounts.buckets['Payables'] = 0;
        }
    }

    // Ensure Weekly logic exists
    ensureWeeklyState();

    const hasBalances = Object.keys(state.balances || {}).length > 0;
    const hasBuckets = Object.values(state.accounts?.buckets || {}).some(v => v !== 0);
    if(state.accounts.surplus === 0 && !hasBalances && !hasBuckets) {
        state.accounts.surplus = state.monthlyIncome;
        initSurplusFromOpening();
    }

    renderLedger();
    renderStrategy();
    updateUndoButtonUI();
    applySettings();
    renderSettings();

    const amortTotal = document.getElementById('amort-total');
    const amortMonths = document.getElementById('amort-months');
    if (amortTotal) amortTotal.oninput = updateAmortCalc;
    if (amortMonths) amortMonths.oninput = updateAmortCalc;
};
