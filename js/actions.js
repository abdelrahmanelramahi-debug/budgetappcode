// --- INCOME LOGIC ---
function updateIncome(val) {
    const num = parseFloat(val);
    if(!isNaN(num)) {
        state.monthlyIncome = num;
        renderStrategy();
        saveState();
    }
}

// --- STATE TRANSACTIONS ---
function ensureAccountsState() {
    if (!state.accounts) {
        state.accounts = { surplus: 0, weekly: { balance: getWeeklyConfigAmount(), week: 1 }, buckets: {} };
    }
    if (!state.accounts.weekly) {
        state.accounts.weekly = { balance: getWeeklyConfigAmount(), week: 1 };
    }
    if (!state.accounts.buckets) state.accounts.buckets = {};
    if (!state.accounts.savingsBuckets) {
        const seed = state.accounts.buckets['General Savings'] ?? 0;
        state.accounts.savingsBuckets = { Main: seed };
    }
}

function setItemBalance(label, value) {
    ensureAccountsState();
    if (label === 'General Savings') {
        state.accounts.savingsBuckets.Main = value;
        syncSavingsTotal();
    } else if (isAccountLabel(label)) {
        state.accounts.buckets[label] = value;
    } else {
        state.balances[label] = value;
    }
}

function removeItemBalance(label) {
    if (isAccountLabel(label)) {
        // Keep account buckets, zero them instead of deleting
        ensureAccountsState();
        if (label === 'General Savings') {
            Object.keys(state.accounts.savingsBuckets).forEach(key => {
                state.accounts.savingsBuckets[key] = 0;
            });
            syncSavingsTotal();
        } else {
            state.accounts.buckets[label] = 0;
        }
    } else if (state.balances[label] !== undefined) {
        delete state.balances[label];
    }
}

function adjustItemBalance(label, delta) {
    const current = getItemBalance(label, 0);
    setItemBalance(label, current + delta);
}

function getSavingsTotal() {
    ensureAccountsState();
    return Object.values(state.accounts.savingsBuckets).reduce((sum, val) => sum + (val || 0), 0);
}

function syncSavingsTotal() {
    ensureAccountsState();
    state.accounts.buckets['General Savings'] = getSavingsTotal();
}

function getPlanAmount(label) {
    for (let s of state.categories) {
        const it = s.items.find(i => i.label === label);
        if (it) return it.amount;
    }
    return 0;
}

function applyTransaction(tx) {
    ensureAccountsState();

    switch (tx.type) {
        case 'adjust_surplus':
            state.accounts.surplus += tx.delta;
            break;
        case 'adjust_item_balance':
            adjustItemBalance(tx.label, tx.delta);
            break;
        case 'set_item_balance':
            setItemBalance(tx.label, tx.value);
            break;
        case 'transfer':
            if (tx.from === 'Surplus') {
                state.accounts.surplus -= tx.amount;
            } else {
                adjustItemBalance(tx.from, -tx.amount);
                if (tx.from === 'Weekly Misc') {
                    state.accounts.weekly.balance -= tx.amount;
                }
            }
            if (tx.to === 'Surplus') {
                state.accounts.surplus += tx.amount;
            } else {
                adjustItemBalance(tx.to, tx.amount);
                if (tx.to === 'Weekly Misc') {
                    state.accounts.weekly.balance += tx.amount;
                }
            }
            break;
        case 'add_item': {
            const sec = state.categories.find(s=>s.id===tx.sid);
            if (!sec) break;
            sec.items.push({ label: tx.label, amount: tx.amount });
            state.accounts.surplus -= tx.amount;
            setItemBalance(tx.label, tx.amount);
            break;
        }
        case 'delete_item': {
            const sec = state.categories.find(s=>s.id===tx.sid);
            if (!sec) break;
            const item = sec.items[tx.idx];
            if (!item) break;
            const currentBalance = getItemBalance(item.label, item.amount);
            state.accounts.surplus += currentBalance;
            removeItemBalance(item.label);
            sec.items.splice(tx.idx, 1);
            break;
        }
        case 'delete_category': {
            const idx = state.categories.findIndex(s => s.id === tx.sid);
            if (idx === -1) break;
            const sec = state.categories[idx];
            sec.items.forEach(i => {
                const bal = getItemBalance(i.label, i.amount);
                state.accounts.surplus += bal;
                removeItemBalance(i.label);
            });
            state.categories.splice(idx, 1);
            break;
        }
        case 'rename_category': {
            const sec = state.categories.find(s => s.id === tx.sid);
            if (sec) sec.label = tx.label;
            break;
        }
        case 'update_item_amount': {
            const sec = state.categories.find(s => s.id === tx.sid);
            if (!sec) break;
            const item = sec.items[tx.idx];
            if (!item) break;
            const oldVal = item.amount;
            const newVal = tx.amount;
            const delta = newVal - oldVal;
            item.amount = newVal;
            delete item.amortData;
            state.accounts.surplus -= delta;
            if (isAccountLabel(item.label) || state.balances[item.label] !== undefined) {
                adjustItemBalance(item.label, delta);
            } else {
                setItemBalance(item.label, newVal);
            }
            break;
        }
        case 'weekly_adjust':
            adjustItemBalance('Weekly Misc', tx.delta);
            state.accounts.weekly.balance += tx.delta;
            break;
        case 'weekly_next':
            state.accounts.weekly.balance += tx.amount;
            state.accounts.weekly.week += 1;
            break;
        case 'food_spend':
            state.food.daysUsed++;
            state.food.history.unshift({type:'spend', amt: tx.amount});
            break;
        case 'food_lock':
            state.food.lockedAmount += tx.amount;
            state.food.history.unshift({type:'lock', amt: tx.amount, label: tx.label});
            break;
        case 'food_release_all':
            state.accounts.surplus += state.food.lockedAmount;
            state.food.lockedAmount = 0;
            break;
        case 'food_deficit_raid':
            state.accounts.surplus += tx.amount;
            state.food.history.unshift({type:'deficit', amt: tx.amount});
            break;
        default:
            break;
    }
}

// --- REALITY CHECK ---
function openRealityCheck() {
    const { totalLiquid } = getLiquidityBreakdown();
    document.getElementById('rc-system-val').innerText = formatMoney(totalLiquid);
    document.getElementById('rc-user-val').value = '';
    toggleModal('reality-check-modal', true);
}

function closeRealityCheck() { toggleModal('reality-check-modal', false); }

function openLiquidityBreakdown() {
    const { totalLiquid, items } = getLiquidityBreakdown();
    document.getElementById('liquidity-breakdown-total').innerText = formatMoney(totalLiquid);

    const list = document.getElementById('liquidity-breakdown-list');
    list.innerHTML = items.map(item => `
        <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
            <div>
                <span class="block text-xs font-bold text-slate-800">${item.label}</span>
                ${item.meta ? `<span class="text-[10px] text-slate-400">${item.meta}</span>` : ''}
            </div>
            <span class="text-xs font-black text-slate-700">${formatMoney(item.amount)}</span>
        </div>
    `).join('') || '<div class="text-center text-[10px] text-slate-300 py-2">No liquidity items</div>';

    toggleModal('liquidity-breakdown-modal', true);
}

function closeLiquidityBreakdown() { toggleModal('liquidity-breakdown-modal', false); }

function confirmRealityCheck() {
    const userVal = parseFloat(document.getElementById('rc-user-val').value);
    if(isNaN(userVal)) return;
    const { totalLiquid } = getLiquidityBreakdown();
    const delta = userVal - totalLiquid;

    pushToUndo();
    applyTransaction({ type: 'adjust_surplus', delta });
    saveState();

    updateGlobalUI();
    closeRealityCheck();
}

function renameCategory(sid) {
    const sec = state.categories.find(s => s.id === sid);
    if(!sec) return;
    const newName = prompt("Rename Category:", sec.label);
    if(newName && newName.trim() !== "") {
        pushToUndo();
        applyTransaction({ type: 'rename_category', sid, label: newName.trim() });
        saveState();
        renderStrategy();
        renderLedger();
    }
}

function deleteCategory(sid) {
    const idx = state.categories.findIndex(s => s.id === sid);
    if(idx === -1) return;
    const sec = state.categories[idx];

    if(confirm(`Delete category "${sec.label}" and refund ${sec.items.length} items to Surplus?`)) {
        pushToUndo();
        applyTransaction({ type: 'delete_category', sid });

        saveState();
        renderStrategy();
        updateGlobalUI();
    }
}

// --- DRAG FUNCTIONS ---
function handleDragOver(e) { e.preventDefault(); }

function handleItemDragStart(e, sid, idx) {
    dragType = 'item';
    dragSrc = { sid, idx };
    e.stopPropagation();
    e.target.style.opacity = '0.5';
}
function handleItemDrop(e, targetSid, targetIdx) {
    e.preventDefault();
    e.stopPropagation();
    if (dragType === 'item' && dragSrc && dragSrc.sid === targetSid && dragSrc.idx !== targetIdx) {
        pushToUndo();
        const items = state.categories.find(s => s.id === targetSid).items;
        const moved = items.splice(dragSrc.idx, 1)[0];
        items.splice(targetIdx, 0, moved);
        saveState();
        renderStrategy();
    }
    dragSrc = null; dragType = null;
}

function handleCatDragStart(e, idx) {
    if(dragType === 'item') return;
    const sec = state.categories[idx];
    if(sec.isSystem) return;
    dragType = 'category';
    dragSrc = { idx };
    e.target.style.opacity = '0.5';
}
function handleCatDrop(e, targetIdx) {
    e.preventDefault();
    if (dragType === 'category' && dragSrc && dragSrc.idx !== targetIdx) {
        pushToUndo();
        const moved = state.categories.splice(dragSrc.idx, 1)[0];
        state.categories.splice(targetIdx, 0, moved);
        saveState();
        renderStrategy();
    }
    dragSrc = null; dragType = null;
}

// --- DEFICIT MANAGEMENT ---
function openDeficitModal() {
    const list = document.getElementById('deficit-list');
    list.innerHTML = '';

    const deficit = Math.abs(state.accounts.surplus);
    ensureWeeklyState();
    const weeklyAvailable = Math.max(0, state.accounts.weekly.balance || 0);
    if (weeklyAvailable > 0) {
        list.innerHTML += `
            <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                <div>
                    <span class="block text-xs font-bold text-slate-800">Weekly Allowance</span>
                    <span class="text-[10px] text-slate-400">Available: ${weeklyAvailable.toFixed(0)}</span>
                </div>
                <button onclick="raidWeekly(${weeklyAvailable})" class="bg-indigo-100 text-indigo-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase">Use</button>
            </div>
        `;
    }

    const foodInfo = getFoodRemainderInfo();
    if (foodInfo.remainder > 0) {
        const take = Math.min(deficit, foodInfo.remainder);
        const postRemainder = Math.max(0, foodInfo.remainder - take);
        const postPerDay = foodInfo.daysLeft > 0 ? (postRemainder / foodInfo.daysLeft) : 0;
        list.innerHTML += `
            <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                <div>
                    <span class="block text-xs font-bold text-slate-800">Food Remainder</span>
                    <span class="text-[10px] text-slate-400">Before: ${foodInfo.dailyRate.toFixed(2)}/day • After: ${postPerDay.toFixed(2)}/day</span>
                </div>
                <button onclick="raidFood(${foodInfo.remainder})" class="bg-indigo-100 text-indigo-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase">Use</button>
            </div>
        `;
    }

    state.categories.forEach(sec => {
        sec.items.forEach(item => {
            if(['Weekly Misc', 'Food Base'].includes(item.label)) return;

            const bal = getItemBalance(item.label, item.amount);
            if(bal > 0) {
                list.innerHTML += `
                    <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                        <div>
                            <span class="block text-xs font-bold text-slate-800">${item.label}</span>
                            <span class="text-[10px] text-slate-400">Available: ${bal}</span>
                        </div>
                        <button onclick="raidBucket('${item.label}', ${bal})" class="bg-indigo-100 text-indigo-600 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase">Use</button>
                    </div>
                `;
            }
        });
    });
    toggleModal('deficit-modal', true);
}
function closeDeficitModal() { toggleModal('deficit-modal', false); }

function raidBucket(label, available) {
    const deficit = Math.abs(state.accounts.surplus);
    const take = Math.min(deficit, available);

    if(take > 0) {
        pushToUndo();
        if(getItemBalance(label, undefined) === undefined) setItemBalance(label, available);
        applyTransaction({ type: 'adjust_item_balance', label, delta: -take });
        applyTransaction({ type: 'adjust_surplus', delta: take });

        logHistory(label, -take, 'Deficit Cover');
        saveState();
        renderLedger();
        if(state.accounts.surplus >= 0) closeDeficitModal();
        else openDeficitModal();
    }
}

function raidWeekly(available) {
    const deficit = Math.abs(state.accounts.surplus);
    const take = Math.min(deficit, available);
    if (take > 0) {
        pushToUndo();
        if(getItemBalance('Weekly Misc', undefined) === undefined) {
            const fullAmt = getWeeklyConfigAmount() * 4;
            setItemBalance('Weekly Misc', fullAmt);
        }
        state.accounts.weekly.balance -= take;
        applyTransaction({ type: 'adjust_item_balance', label: 'Weekly Misc', delta: -take });
        applyTransaction({ type: 'adjust_surplus', delta: take });
        logHistory('Weekly Misc', -take, 'Deficit Cover');
        saveState();
        renderLedger();
        if(state.accounts.surplus >= 0) closeDeficitModal();
        else openDeficitModal();
    }
}

function raidFood(available) {
    const deficit = Math.abs(state.accounts.surplus);
    const take = Math.min(deficit, available);
    const { fItem } = getFoodRemainderInfo();
    if (take > 0 && fItem) {
        pushToUndo();
        fItem.amount = Math.max(0, fItem.amount - take);
        applyTransaction({ type: 'adjust_surplus', delta: take });
        applyTransaction({ type: 'food_deficit_raid', amount: take });
        logHistory('Food Base', -take, 'Deficit Cover');
        saveState();
        renderLedger();
        if(state.accounts.surplus >= 0) closeDeficitModal();
        else openDeficitModal();
    }
}

// --- MODALS ---
function toggleModal(id, show) {
    const el = document.getElementById(id);
    if(show) { el.classList.remove('hidden'); setTimeout(()=>el.classList.add('modal-open'), 10); }
    else { el.classList.remove('modal-open'); setTimeout(()=>el.classList.add('hidden'), 300); }
}

// DANGER ZONE
function openDangerModal(type, targetId) {
    const input = document.getElementById('danger-input');
    const phraseSpan = document.getElementById('danger-phrase');
    const msg = document.getElementById('danger-msg');

    input.value = '';

    if(type === 'global') {
        requiredDangerPhrase = "DELETE ALL";
        msg.innerText = "You are about to delete ALL budget categories and items. This will wipe your strategy.";
        pendingDangerAction = function() {
            state.categories = [];
            ensureSystemSavings();
            ensureCoreItems();
            state.balances = {};
            ensureAccountsState();
            state.accounts.buckets = {};
            initSurplusFromOpening();
            state.food = { daysTotal: 28, daysUsed: 0, lockedAmount: 0, history: [] };
            state.accounts.weekly = { balance: getWeeklyConfigAmount(), week: 1 };
            state.histories = {};
        };
    } else if (type === 'section') {
        requiredDangerPhrase = "CLEAR ITEMS";
        msg.innerText = "You are about to remove all items from this category.";
        pendingDangerAction = function() {
            const sec = state.categories.find(s=>s.id === targetId);
            if(sec) {
                sec.items.forEach(i => {
                    const bal = getItemBalance(i.label, i.amount);
                    state.accounts.surplus += bal;
                    removeItemBalance(i.label);
                });
                sec.items = [];
            }
        };
    }

    phraseSpan.innerText = requiredDangerPhrase;
    toggleModal('danger-modal', true);
}

function closeDangerModal() { toggleModal('danger-modal', false); }

function confirmDangerAction() {
    const val = document.getElementById('danger-input').value.toUpperCase();
    if(val === requiredDangerPhrase && pendingDangerAction) {
        pushToUndo();
        pendingDangerAction();
        saveState();
        renderStrategy();
        closeDangerModal();
    } else {
        alert("Incorrect phrase.");
    }
}

// Add Category
function openAddCategoryTool() {
    document.getElementById('new-cat-label').value = '';
    document.getElementById('new-cat-single').checked = false;
    toggleModal('add-category-tool', true);
}
function closeAddCategoryTool() { toggleModal('add-category-tool', false); }

function confirmAddCategory() {
    const label = document.getElementById('new-cat-label').value;
    const isSingle = document.getElementById('new-cat-single').checked;

    if(label) {
        pushToUndo();
        const newId = 'cat_' + Date.now().toString(36);
        state.categories.push({
            id: newId,
            label: label,
            isLedgerLinked: true,
            isSingleAction: isSingle,
            items: []
        });
        saveState();
        renderStrategy();
        closeAddCategoryTool();
    }
}

// Amortization
function openAmortTool(sid, idx) {
    currentAmort = {sid, idx};
    const item = state.categories.find(s=>s.id===sid).items[idx];
    document.getElementById('amortization-title').innerText = item.label;
    document.getElementById('amort-total').value = item.amortData ? item.amortData.total : item.amount;
    document.getElementById('amort-months').value = item.amortData ? item.amortData.months : 1;
    toggleModal('amortization-tool', true);
    updateAmortCalc();
}

function updateAmortCalc() {
    const t = parseFloat(document.getElementById('amort-total').value)||0;
    const m = parseFloat(document.getElementById('amort-months').value)||1;
    document.getElementById('amort-preview').innerText = (t/m).toFixed(2);
}
function saveAmortization() {
    const t = parseFloat(document.getElementById('amort-total').value);
    const m = parseFloat(document.getElementById('amort-months').value);
    const item = state.categories.find(s=>s.id===currentAmort.sid).items[currentAmort.idx];

    pushToUndo();
    const oldVal = item.amount;
    const newVal = t/m;
    item.amortData = {total: t, months: m};
    applyTransaction({ type: 'update_item_amount', sid: currentAmort.sid, idx: currentAmort.idx, amount: newVal });
    saveState();
    renderStrategy(); toggleModal('amortization-tool', false);
}
function applyDirectCost() {
    const t = parseFloat(document.getElementById('amort-total').value);
    const item = state.categories.find(s=>s.id===currentAmort.sid).items[currentAmort.idx];
    pushToUndo();
    delete item.amortData;
    applyTransaction({ type: 'update_item_amount', sid: currentAmort.sid, idx: currentAmort.idx, amount: t });
    saveState();
    renderStrategy(); toggleModal('amortization-tool', false);
}
function closeAmortizationTool() { toggleModal('amortization-tool', false); }

// Add Items
function openAddItemTool(sid) {
    currentAddSectionId = sid;
    document.getElementById('new-item-label').value = '';
    document.getElementById('new-item-amount').value = '';
    toggleModal('add-item-tool', true);
    document.getElementById('new-item-label').focus();
}
function closeAddItemTool() { toggleModal('add-item-tool', false); }
function confirmAddItem() {
    const label = document.getElementById('new-item-label').value;
    const amount = parseFloat(document.getElementById('new-item-amount').value);
    if(label && !isNaN(amount)) {
        pushToUndo();
        applyTransaction({ type: 'add_item', sid: currentAddSectionId, label, amount });
        saveState();
        renderStrategy();
        closeAddItemTool();
    }
}

// Delete Items
function openDeleteModal(sid, idx) {
    itemToDelete = {sid, idx};
    toggleModal('delete-modal', true);
}
function closeDeleteModal() { toggleModal('delete-modal', false); }
function confirmDelete() {
    if(itemToDelete) {
        pushToUndo();
        applyTransaction({ type: 'delete_item', sid: itemToDelete.sid, idx: itemToDelete.idx });
        saveState();
        renderStrategy();
        closeDeleteModal();
    }
}

// Ledger Actions
function openTool(label, displayTitle, autoTransfer = false) {
    activeCat = label;
    document.getElementById('tool-title').innerText = displayTitle || label;
    document.getElementById('tool-value').value = '';

    // Reset UI state
    const std = document.getElementById('tool-actions-standard');
    const trf = document.getElementById('tool-transfer-interface');

    std.classList.remove('hidden');
    trf.classList.add('hidden');

    toggleModal('input-tool', true);
    renderCategoryHistory();

    // Auto Open Transfer Mode if requested
    if(autoTransfer) {
        toggleTransferMode();
    }
}
function closeTool() { toggleModal('input-tool', false); }

function toggleTransferMode() {
    const std = document.getElementById('tool-actions-standard');
    const trf = document.getElementById('tool-transfer-interface');
    const list = document.getElementById('transfer-target-list');

    if(trf.classList.contains('hidden')) {
        std.classList.add('hidden');
        trf.classList.remove('hidden');
        renderTransferTargets(list);
    } else {
        std.classList.remove('hidden');
        trf.classList.add('hidden');
    }
}

function renderTransferTargets(container) {
    container.innerHTML = '';

    // Define Priority Targets
    const priorities = [
        { id: 'Weekly Misc', label: 'Weekly Allowance', bg: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
        { id: 'General Savings', label: 'General Savings', bg: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        { id: 'Surplus', label: 'Surplus (Unallocated)', bg: 'bg-slate-200 text-slate-700 border-slate-300' }
    ];

    // Render Priorities
    priorities.forEach(p => {
        if(p.id !== activeCat) {
            container.innerHTML += `
                <button onclick="executeTransfer('${p.id}')" class="w-full text-left p-3 rounded-lg border flex justify-between items-center ${p.bg} font-bold text-xs mb-1 hover:brightness-95 transition">
                    <span>${p.label}</span>
                    <span class="opacity-50">→</span>
                </button>
            `;
        }
    });

    // Divider
    container.innerHTML += `<div class="h-px bg-slate-200 my-2"></div>`;

    // Render Other Categories
    state.categories.forEach(sec => {
        sec.items.forEach(item => {
            // Skip if it is the current active category, or if it's already in priority list
            if(item.label === activeCat || ['Weekly Misc', 'General Savings'].includes(item.label)) return;
            if(item.label === 'Food Base') return; // Usually locked/automated

            container.innerHTML += `
                <button onclick="executeTransfer('${item.label}')" class="w-full text-left p-2.5 rounded-lg bg-white border border-slate-200 flex justify-between items-center text-slate-600 font-bold text-[11px] hover:bg-slate-50 transition">
                    <span>${item.label}</span>
                    <span class="text-slate-300">+</span>
                </button>
            `;
        });
    });
}

function executeTransfer(targetId) {
    const val = parseFloat(document.getElementById('tool-value').value);
    if(!val || val <= 0) return;

    pushToUndo();

    if (activeCat !== 'Surplus' && getItemBalance(activeCat, undefined) === undefined) {
        setItemBalance(activeCat, getPlanAmount(activeCat));
    }
    if (targetId !== 'Surplus' && getItemBalance(targetId, undefined) === undefined) {
        setItemBalance(targetId, getPlanAmount(targetId));
    }

    applyTransaction({ type: 'transfer', from: activeCat, to: targetId, amount: val });

    logHistory(activeCat, -val, `Trf to ${targetId}`);
    if (targetId !== 'Surplus') {
        logHistory(targetId, val, `Trf from ${activeCat}`);
    }

    saveState();
    renderLedger();
    updateGlobalUI(); // Ensure surplus/reality updates
    closeTool();
}

function executeAction(type) {
    const val = parseFloat(document.getElementById('tool-value').value);
    if(val) {
        if (activeCat === 'Surplus') {
            const delta = type === 'deduct' ? -val : val;
            if(!canApplySurplusDelta(delta)) return;
            if(shouldConfirmSurplusEdit()) {
                const actionLabel = type === 'deduct' ? 'deduct' : 'add';
                const proceed = confirm(`You are about to ${actionLabel} funds directly to Surplus. This creates or removes money from thin air. Continue?`);
                if (!proceed) return;
            }
        }
        pushToUndo();
        const mod = type==='deduct' ? -val : val;

        if (activeCat === 'Surplus') {
            applyTransaction({ type: 'adjust_surplus', delta: mod });
        } else {
            if (getItemBalance(activeCat, undefined) === undefined) {
                setItemBalance(activeCat, getPlanAmount(activeCat));
            }
            applyTransaction({ type: 'adjust_item_balance', label: activeCat, delta: mod });
        }

        logHistory(activeCat, mod, 'Manual');
        saveState();
        renderLedger();
        updateGlobalUI();
        closeTool();
    }
}

function completeTask(label) {
    pushToUndo();
    if (getItemBalance(label, undefined) === undefined) {
         setItemBalance(label, getPlanAmount(label));
    }

    const current = getItemBalance(label, 0);
    setItemBalance(label, 0);
    logHistory(label, -current, 'Completed');
    saveState();
    renderLedger();
}

// Food
function spendFoodDay() {
    if(state.food.daysUsed < state.food.daysTotal) {
        pushToUndo();
        applyTransaction({ type: 'food_spend', amount: 30 });
        saveState();
        renderLedger();
    }
}

function buyFoodDay() {
    const daysInput = parseFloat(document.getElementById('food-lock-val').value);
    if(!daysInput || daysInput <= 0) return;

    // 1. Calculate Cost based on Base/28
    const fSec = state.categories.find(s=>s.id==='core_essentials') || state.categories.find(s=>s.id==='foundations');
    const fItem = fSec ? fSec.items.find(i=>i.label==='Food Base') : null;
    const foodBase = fItem ? fItem.amount : 840;
    const dailyRate = foodBase / 28;
    const totalCost = dailyRate * daysInput;

    pushToUndo();

    // 2. Waterfall Deduction
    let coveredByWeekly = 0;
    let coveredBySurplus = 0;

    if (state.accounts.weekly.balance >= totalCost) {
        // Weekly covers it all
        coveredByWeekly = totalCost;
    } else {
        // Weekly covers some, Surplus covers rest
        coveredByWeekly = Math.max(0, state.accounts.weekly.balance);
        coveredBySurplus = totalCost - coveredByWeekly;
    }

    // Apply Deductions
    state.accounts.weekly.balance -= coveredByWeekly; // Visual limit
    applyTransaction({ type: 'adjust_item_balance', label: 'Weekly Misc', delta: -coveredByWeekly });
    applyTransaction({ type: 'adjust_surplus', delta: -coveredBySurplus });

    // 3. Add to Visual (Buffer)
    applyTransaction({ type: 'food_lock', amount: totalCost, label: `+${daysInput} Days` });
    document.getElementById('food-lock-val').value = '';

    saveState();
    renderLedger();
    updateGlobalUI();
}

function releaseAllBuffer() {
    if(state.food.lockedAmount > 0) {
        pushToUndo();
        applyTransaction({ type: 'food_release_all' });
        saveState();
        renderLedger();
    }
}
function undoFood(idx) {
    const h = state.food.history[idx];
    pushToUndo();
    if(h.type==='spend') state.food.daysUsed--;
    else {
        // Restore funds (Simple restoration to surplus for now to avoid complex reverse waterfall)
        state.food.lockedAmount -= h.amt;
        state.accounts.surplus += h.amt;
    }
    state.food.history.splice(idx, 1);
    saveState();
    renderLedger();
    updateGlobalUI();
}

// Weekly
function inlineWeeklyAdjust(dir) {
    const val = parseFloat(document.getElementById('weekly-inline-val').value);
    if(val) {
        pushToUndo();
        applyTransaction({ type: 'weekly_adjust', delta: val * dir });
        logHistory('Weekly Misc', val*dir, 'Spend');
        document.getElementById('weekly-inline-val').value = '';
        saveState();
        renderLedger();
    }
}
function topUpWeeklyInline() {
    const val = parseFloat(document.getElementById('weekly-inline-val').value);
    if(val) {
        pushToUndo();
        applyTransaction({ type: 'adjust_surplus', delta: -val });
        applyTransaction({ type: 'weekly_adjust', delta: val });
        logHistory('Weekly Misc', val, 'Top Up');
        document.getElementById('weekly-inline-val').value = '';
        saveState();
        renderLedger();
    }
}

function nextWeek() {
    ensureWeeklyState();
    if (state.accounts.weekly.week >= WEEKLY_MAX_WEEKS) {
        alert('Week limit reached. Weekly allowance is capped at 4 weeks.');
        return;
    }

    const weeklyAmt = getWeeklyConfigAmount();

    if(confirm(`Start next week? This will add +${formatMoney(weeklyAmt)} ${getCurrencyLabel()} to your weekly allowance.`)) {
        pushToUndo();
        applyTransaction({ type: 'weekly_next', amount: weeklyAmt });
        // Note: We don't add to state.balances['Weekly Misc'] here because that bucket holds the *total* month's assets already.
        // The 'Weekly Misc' balance drains as we spend.
        // The 'state.weekly.balance' acts as a view/limit for the current week.
        saveState();
        renderLedger();
    }
}

// Surplus
function toggleSurplusControls() {
    const el = document.getElementById('surplus-controls');
    if(el.classList.contains('hidden')) el.classList.remove('hidden'); else el.classList.add('hidden');
}
function shouldConfirmSurplusEdit() {
    return state.settings?.confirmSurplusEdits !== false;
}
function canApplySurplusDelta(delta) {
    if(state.settings?.allowNegativeSurplus === false && (state.accounts.surplus + delta) < 0) {
        alert('This would make Surplus negative. Enable "Allow negative Surplus" in Settings to proceed.');
        return false;
    }
    return true;
}
function adjustGlobalSurplus(dir) {
    const val = parseFloat(document.getElementById('surplus-adjust-val').value);
    if(val) {
        const delta = val * dir;
        if(!canApplySurplusDelta(delta)) return;
        if(shouldConfirmSurplusEdit()) {
            const actionLabel = dir > 0 ? 'add' : 'deduct';
            const proceed = confirm(`You are about to ${actionLabel} funds directly to Surplus. This creates or removes money from thin air. Continue?`);
            if (!proceed) return;
        }
        pushToUndo();
        applyTransaction({ type: 'adjust_surplus', delta });
        document.getElementById('surplus-adjust-val').value = '';
        saveState();
        updateGlobalUI();
    }
}

// Fast Update (Budget Plan) - FIXED: No full re-render on input
function fastUpdateItemAmount(sid, idx, val) {
    const num = parseFloat(val) || 0;
    const sec = state.categories.find(s => s.id === sid);
    const item = sec.items[idx];

    applyTransaction({ type: 'update_item_amount', sid, idx, amount: num });

    saveState();

    // UI UPDATES (Without calling renderStrategy)
    updateGlobalUI();

    // Update Section Percentage
    const secTotal = sec.items.reduce((a, b) => a + b.amount, 0);
    const perc = state.monthlyIncome > 0 ? Math.round((secTotal/state.monthlyIncome)*100) : 0;
    const percEl = document.getElementById(`sec-perc-${sid}`);
    if(percEl) percEl.innerText = perc + "%";

    if(item.label === 'Food Base') {
        const slider = document.getElementById('food-daily-slider');
        const input = document.getElementById('food-base-input');
        if(slider) {
            const dailyRate = state.food.daysTotal > 0 ? (num / state.food.daysTotal) : 0;
            const dailyRounded = Math.round(dailyRate);
            if(slider.value !== String(dailyRounded)) slider.value = String(dailyRounded);
        }
        if(input && input.value !== String(num)) input.value = String(num);
        const badge = document.getElementById('food-base-daily-badge');
        if(badge) {
            const dailyRate = state.food.daysTotal > 0 ? (num / state.food.daysTotal) : 0;
            badge.innerText = `${formatMoney(dailyRate)}/day`;
        }
    }
}

function syncFoodBaseAmount(sid, idx, val) {
    const num = parseFloat(val) || 0;
    const slider = document.getElementById('food-daily-slider');
    const input = document.getElementById('food-base-input');
    if(slider) {
        const dailyRate = state.food.daysTotal > 0 ? (num / state.food.daysTotal) : 0;
        const dailyRounded = Math.round(dailyRate);
        if(slider.value !== String(dailyRounded)) slider.value = String(dailyRounded);
    }
    if(input && input.value !== String(num)) input.value = String(num);
    fastUpdateItemAmount(sid, idx, num);
}

function syncFoodDailyRate(sid, idx, val) {
    const dailyRate = parseFloat(val) || 0;
    const total = dailyRate * (state.food.daysTotal || 0);
    syncFoodBaseAmount(sid, idx, total);
}

// Paycheck + Allocation
function getAllocatableItems() {
    const items = [];
    state.categories.forEach(sec => {
        sec.items.forEach(item => {
            if (item.label === 'Food Base') return;
            if (item.amount > 0) {
                items.push({ label: item.label, amount: item.amount });
            }
        });
    });
    return items;
}

function applyPaycheckAdd() {
    const val = parseFloat(document.getElementById('paycheck-amount').value);
    if(!val || val <= 0) return;
    pushToUndo();
    applyTransaction({ type: 'adjust_surplus', delta: val });
    document.getElementById('paycheck-amount').value = '';
    saveState();
    renderLedger();
    renderStrategy();
    updateGlobalUI();
}

function applyPaycheckDistribute() {
    const val = parseFloat(document.getElementById('paycheck-amount').value);
    if(!val || val <= 0) return;

    const items = getAllocatableItems().map(item => {
        const current = getItemBalance(item.label, 0);
        const deficit = Math.max(0, item.amount - current);
        return { ...item, deficit };
    }).filter(item => item.deficit > 0);

    const totalDeficit = items.reduce((sum, i) => sum + i.deficit, 0);

    pushToUndo();
    applyTransaction({ type: 'adjust_surplus', delta: val });

    if (totalDeficit <= 0) {
        alert('All planned categories are already funded. The paycheck was added to Surplus.');
        document.getElementById('paycheck-amount').value = '';
        saveState();
        renderLedger();
        renderStrategy();
        updateGlobalUI();
        return;
    }

    items.forEach(item => {
        if (item.deficit > 0) {
            applyTransaction({ type: 'transfer', from: 'Surplus', to: item.label, amount: item.deficit });
            logHistory(item.label, item.deficit, 'Distribute');
        }
    });

    const leftoverFromPaycheck = Math.max(0, val - totalDeficit);
    if (leftoverFromPaycheck > 0) {
        alert(`Fully funded all planned categories. ${formatMoney(leftoverFromPaycheck)} ${getCurrencyLabel()} stayed in Surplus.`);
    } else if (totalDeficit > val) {
        const shortfall = totalDeficit - val;
        alert(`Plan required more than this paycheck. ${formatMoney(shortfall)} ${getCurrencyLabel()} was taken from Surplus.`);
    }

    document.getElementById('paycheck-amount').value = '';
    saveState();
    renderLedger();
    renderStrategy();
    updateGlobalUI();
}

// Savings Buckets
function openSavingsBuckets() {
    renderSavingsBuckets();
    toggleModal('savings-buckets-modal', true);
}

function closeSavingsBuckets() {
    toggleModal('savings-buckets-modal', false);
}

function adjustSavingsBucket(bucketKey, delta) {
    ensureAccountsState();
    if (state.accounts.savingsBuckets[bucketKey] === undefined) {
        state.accounts.savingsBuckets[bucketKey] = 0;
    }
    state.accounts.savingsBuckets[bucketKey] += delta;
    if (state.accounts.savingsBuckets[bucketKey] < 0) {
        state.accounts.savingsBuckets[bucketKey] = 0;
    }
    syncSavingsTotal();
}

function getSavingsBucketAmount(bucketKey) {
    ensureAccountsState();
    return state.accounts.savingsBuckets[bucketKey] || 0;
}

function renderSavingsBuckets() {
    ensureAccountsState();
    const list = document.getElementById('savings-buckets-list');
    if (!list) return;
    const entries = Object.entries(state.accounts.savingsBuckets);
    if (!entries.length) {
        list.innerHTML = '<div class="text-center text-[10px] text-slate-300 py-2">No buckets yet</div>';
        return;
    }
    list.innerHTML = entries.map(([key, amount]) => `
        <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
            <div>
                <span class="block text-xs font-bold text-slate-800">${key}</span>
                <span class="text-[10px] text-slate-400">${formatMoney(amount)} ${getCurrencyLabel()}</span>
            </div>
            <div class="flex gap-2">
                <button onclick="applySavingsBucketDelta('${key}', 1)" class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg text-[10px] font-bold uppercase">Add</button>
                <button onclick="applySavingsBucketDelta('${key}', -1)" class="bg-red-100 text-red-600 px-2 py-1 rounded-lg text-[10px] font-bold uppercase">Deduct</button>
                <button onclick="transferSavingsBucketToSurplus('${key}')" class="bg-slate-200 text-slate-700 px-2 py-1 rounded-lg text-[10px] font-bold uppercase">To Surplus</button>
            </div>
        </div>
    `).join('');
}

function applySavingsBucketDelta(bucketKey, dir) {
    const val = parseFloat(document.getElementById('savings-bucket-amount').value);
    if (!val || val <= 0) return;
    pushToUndo();
    if (dir > 0) {
        if(!canApplySurplusDelta(-val)) return;
        adjustSavingsBucket(bucketKey, val);
        applyTransaction({ type: 'adjust_surplus', delta: -val });
    } else {
        const available = getSavingsBucketAmount(bucketKey);
        const take = Math.min(val, available);
        if (take <= 0) return;
        adjustSavingsBucket(bucketKey, -take);
        applyTransaction({ type: 'adjust_surplus', delta: take });
    }
    saveState();
    renderSavingsBuckets();
    updateGlobalUI();
}

function transferSavingsBucketToSurplus(bucketKey) {
    const val = parseFloat(document.getElementById('savings-bucket-amount').value);
    if (!val || val <= 0) return;
    pushToUndo();
    const available = getSavingsBucketAmount(bucketKey);
    const take = Math.min(val, available);
    if (take <= 0) return;
    adjustSavingsBucket(bucketKey, -take);
    applyTransaction({ type: 'adjust_surplus', delta: take });
    saveState();
    renderSavingsBuckets();
    updateGlobalUI();
}

function createSavingsBucket() {
    const input = document.getElementById('savings-bucket-name');
    const name = input?.value?.trim();
    if (!name) return;
    ensureAccountsState();
    if (state.accounts.savingsBuckets[name] !== undefined) {
        alert('Bucket already exists.');
        return;
    }
    pushToUndo();
    state.accounts.savingsBuckets[name] = 0;
    syncSavingsTotal();
    input.value = '';
    saveState();
    renderSavingsBuckets();
    updateGlobalUI();
}

// Settings
function saveSettingsFromUI() {
    const currencyInput = document.getElementById('settings-currency');
    const decimalsSelect = document.getElementById('settings-decimals');
    const confirmSurplus = document.getElementById('settings-confirm-surplus');
    const allowNegative = document.getElementById('settings-allow-negative');
    const themeSelect = document.getElementById('settings-theme');
    const compactToggle = document.getElementById('settings-compact');

    const currency = currencyInput?.value?.trim() || 'AED';
    const decimals = parseInt(decimalsSelect?.value, 10);

    state.settings = {
        ...state.settings,
        currency,
        decimals: Number.isNaN(decimals) ? 2 : decimals,
        confirmSurplusEdits: !!confirmSurplus?.checked,
        allowNegativeSurplus: !!allowNegative?.checked,
        theme: themeSelect?.value || 'light',
        compact: !!compactToggle?.checked
    };

    saveState();
    applySettings();
    renderLedger();
    renderStrategy();
    updateGlobalUI();
    renderSettings();
}

function rebuildTotals() {
    pushToUndo();
    ensureAccountsState();
    state.categories.forEach(sec => {
        sec.items.forEach(item => {
            if (isAccountLabel(item.label)) {
                if (item.label === 'General Savings') {
                    if (state.accounts.savingsBuckets.Main === undefined) {
                        state.accounts.savingsBuckets.Main = item.amount;
                    }
                    syncSavingsTotal();
                } else if (state.accounts.buckets[item.label] === undefined) {
                    state.accounts.buckets[item.label] = item.amount;
                }
            } else if (state.balances[item.label] === undefined) {
                state.balances[item.label] = item.amount;
            }
        });
    });
    saveState();
    renderLedger();
    renderStrategy();
    updateGlobalUI();
}

function exportState() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finance-command-backup-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function triggerImport() {
    const input = document.getElementById('settings-import-file');
    if(input) input.click();
}

function importStateFile(file) {
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            state = { ...state, ...imported };
            migrateState();
            ensureSystemSavings();
            ensureCoreItems();
            ensureSettings();
            saveState();
            location.reload();
        } catch (err) {
            alert('Import failed. The file is not valid JSON.');
        }
    };
    reader.readAsText(file);
}

function resetAppData() {
    const proceed = confirm('This will delete all local data and reload the app. Continue?');
    if(!proceed) return;
    localStorage.removeItem('financeCmd_state');
    location.reload();
}
