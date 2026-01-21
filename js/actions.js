// --- INCOME LOGIC ---
function updateIncome(val) {
    const num = parseFloat(val);
    if(!isNaN(num)) {
        state.monthlyIncome = num;
        renderStrategy();
        saveState();
    }
}

// --- REALITY CHECK ---
function openRealityCheck() {
    const { totalLiquid } = getLiquidityBreakdown();
    document.getElementById('rc-system-val').innerText = totalLiquid.toLocaleString(undefined, {minimumFractionDigits: 2});
    document.getElementById('rc-user-val').value = '';
    toggleModal('reality-check-modal', true);
}

function closeRealityCheck() { toggleModal('reality-check-modal', false); }

function openLiquidityBreakdown() {
    const { totalLiquid, items } = getLiquidityBreakdown();
    document.getElementById('liquidity-breakdown-total').innerText = totalLiquid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

    const list = document.getElementById('liquidity-breakdown-list');
    list.innerHTML = items.map(item => `
        <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
            <div>
                <span class="block text-xs font-bold text-slate-800">${item.label}</span>
                ${item.meta ? `<span class="text-[10px] text-slate-400">${item.meta}</span>` : ''}
            </div>
            <span class="text-xs font-black text-slate-700">${item.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
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
    state.surplus += delta;
    saveState();

    updateGlobalUI();
    closeRealityCheck();
}

function renameCategory(sid) {
    const sec = state.strategy.find(s => s.id === sid);
    if(!sec) return;
    const newName = prompt("Rename Category:", sec.label);
    if(newName && newName.trim() !== "") {
        pushToUndo();
        sec.label = newName.trim();
        saveState();
        renderStrategy();
        renderLedger();
    }
}

function deleteCategory(sid) {
    const idx = state.strategy.findIndex(s => s.id === sid);
    if(idx === -1) return;
    const sec = state.strategy[idx];

    if(confirm(`Delete category "${sec.label}" and refund ${sec.items.length} items to Surplus?`)) {
        pushToUndo();

        // Refund items
        sec.items.forEach(i => {
            const bal = state.balances[i.label] !== undefined ? state.balances[i.label] : i.amount;
            state.surplus += bal;
            if(state.balances[i.label]) delete state.balances[i.label];
        });

        // Remove category
        state.strategy.splice(idx, 1);

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
        const items = state.strategy.find(s => s.id === targetSid).items;
        const moved = items.splice(dragSrc.idx, 1)[0];
        items.splice(targetIdx, 0, moved);
        saveState();
        renderStrategy();
    }
    dragSrc = null; dragType = null;
}

function handleCatDragStart(e, idx) {
    if(dragType === 'item') return;
    const sec = state.strategy[idx];
    if(sec.isSystem) return;
    dragType = 'category';
    dragSrc = { idx };
    e.target.style.opacity = '0.5';
}
function handleCatDrop(e, targetIdx) {
    e.preventDefault();
    if (dragType === 'category' && dragSrc && dragSrc.idx !== targetIdx) {
        pushToUndo();
        const moved = state.strategy.splice(dragSrc.idx, 1)[0];
        state.strategy.splice(targetIdx, 0, moved);
        saveState();
        renderStrategy();
    }
    dragSrc = null; dragType = null;
}

// --- DEFICIT MANAGEMENT ---
function openDeficitModal() {
    const list = document.getElementById('deficit-list');
    list.innerHTML = '';

    const deficit = Math.abs(state.surplus);
    ensureWeeklyState();
    const weeklyAvailable = Math.max(0, state.weekly.balance || 0);
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

    state.strategy.forEach(sec => {
        sec.items.forEach(item => {
            if(['Weekly Misc', 'Food Base'].includes(item.label)) return;

            const bal = state.balances[item.label] !== undefined ? state.balances[item.label] : item.amount;
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
    const deficit = Math.abs(state.surplus);
    const take = Math.min(deficit, available);

    if(take > 0) {
        pushToUndo();
        if(state.balances[label] === undefined) state.balances[label] = available;

        state.balances[label] -= take;
        state.surplus += take;

        logHistory(label, -take, 'Deficit Cover');
        saveState();
        renderLedger();
        if(state.surplus >= 0) closeDeficitModal();
        else openDeficitModal();
    }
}

function raidWeekly(available) {
    const deficit = Math.abs(state.surplus);
    const take = Math.min(deficit, available);
    if (take > 0) {
        pushToUndo();
        if(state.balances['Weekly Misc'] === undefined) {
            const fullAmt = getWeeklyConfigAmount() * 4;
            state.balances['Weekly Misc'] = fullAmt;
        }
        state.weekly.balance -= take;
        state.balances['Weekly Misc'] -= take;
        state.surplus += take;
        logHistory('Weekly Misc', -take, 'Deficit Cover');
        saveState();
        renderLedger();
        if(state.surplus >= 0) closeDeficitModal();
        else openDeficitModal();
    }
}

function raidFood(available) {
    const deficit = Math.abs(state.surplus);
    const take = Math.min(deficit, available);
    const { fItem } = getFoodRemainderInfo();
    if (take > 0 && fItem) {
        pushToUndo();
        fItem.amount = Math.max(0, fItem.amount - take);
        state.surplus += take;
        state.food.history.unshift({type:'deficit', amt: take});
        logHistory('Food Base', -take, 'Deficit Cover');
        saveState();
        renderLedger();
        if(state.surplus >= 0) closeDeficitModal();
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
            state.strategy = [];
            ensureSystemSavings();
            ensureCoreItems();
            state.balances = {};
            initSurplusFromOpening();
            state.food = { daysTotal: 28, daysUsed: 0, lockedAmount: 0, history: [] };
            state.weekly = { balance: 80, week: 1 };
            state.histories = {};
        };
    } else if (type === 'section') {
        requiredDangerPhrase = "CLEAR ITEMS";
        msg.innerText = "You are about to remove all items from this category.";
        pendingDangerAction = function() {
            const sec = state.strategy.find(s=>s.id === targetId);
            if(sec) {
                sec.items.forEach(i => {
                    const bal = state.balances[i.label] !== undefined ? state.balances[i.label] : i.amount;
                    state.surplus += bal;
                    if(state.balances[i.label]) delete state.balances[i.label];
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
        state.strategy.push({
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
    const item = state.strategy.find(s=>s.id===sid).items[idx];
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
    const item = state.strategy.find(s=>s.id===currentAmort.sid).items[currentAmort.idx];

    pushToUndo();
    const oldVal = item.amount;
    const newVal = t/m;
    item.amount = newVal;
    item.amortData = {total: t, months: m};
    state.surplus -= (newVal - oldVal);
    saveState();
    renderStrategy(); toggleModal('amortization-tool', false);
}
function applyDirectCost() {
    const t = parseFloat(document.getElementById('amort-total').value);
    const item = state.strategy.find(s=>s.id===currentAmort.sid).items[currentAmort.idx];
    pushToUndo();
    const oldVal = item.amount;
    item.amount = t;
    delete item.amortData;
    state.surplus -= (t - oldVal);
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
        const sec = state.strategy.find(s=>s.id===currentAddSectionId);
        sec.items.push({label: label, amount: amount});
        state.surplus -= amount;
        state.balances[label] = amount;
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
        const sec = state.strategy.find(s=>s.id===itemToDelete.sid);
        const item = sec.items[itemToDelete.idx];
        const currentBalance = state.balances[item.label] !== undefined ? state.balances[item.label] : item.amount;
        state.surplus += currentBalance;
        if(state.balances[item.label] !== undefined) {
            delete state.balances[item.label];
        }
        sec.items.splice(itemToDelete.idx, 1);
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
    state.strategy.forEach(sec => {
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

    // 1. Deduct from Source (activeCat)
    if (activeCat === 'Surplus') {
        state.surplus -= val;
    } else {
        if (state.balances[activeCat] === undefined) {
             // Initialize if missing
             let initAmt = 0;
             state.strategy.forEach(s => {
                 const it = s.items.find(i => i.label === activeCat);
                 if(it) initAmt = it.amount;
             });
             state.balances[activeCat] = initAmt;
        }
        state.balances[activeCat] -= val;
    }

    logHistory(activeCat, -val, `Trf to ${targetId}`);

    // 2. Add to Target
    if (targetId === 'Surplus') {
        state.surplus += val;
    } else {
        // Handle Weekly Special Logic
        if (targetId === 'Weekly Misc') {
            state.weekly.balance += val; // Update view limit
        }

        // Standard Ledger Update
        if (state.balances[targetId] === undefined) {
            // Check if it's a strategy item to get default
             let initAmt = 0;
             if(targetId === 'General Savings') initAmt = 1457; // Fallback default
             else {
                 state.strategy.forEach(s => {
                     const it = s.items.find(i => i.label === targetId);
                     if(it) initAmt = it.amount;
                 });
             }
             state.balances[targetId] = initAmt;
        }
        state.balances[targetId] += val;
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
            const actionLabel = type === 'deduct' ? 'deduct' : 'add';
            const proceed = confirm(`You are about to ${actionLabel} funds directly to Surplus. This creates or removes money from thin air. Continue?`);
            if (!proceed) return;
        }
        pushToUndo();
        const mod = type==='deduct' ? -val : val;

        if (activeCat === 'Surplus') {
            state.surplus += mod;
        } else {
            if (state.balances[activeCat] === undefined) {
                let initAmt = 0;
                state.strategy.forEach(s => {
                    const it = s.items.find(i => i.label === activeCat);
                    if(it) initAmt = it.amount;
                });
                state.balances[activeCat] = initAmt;
            }
            state.balances[activeCat] += mod;
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
    if (state.balances[label] === undefined) {
         let initAmt = 0;
         state.strategy.forEach(s => {
             const it = s.items.find(i => i.label === label);
             if(it) initAmt = it.amount;
         });
         state.balances[label] = initAmt;
    }

    const current = state.balances[label];
    state.balances[label] = 0;
    logHistory(label, -current, 'Completed');
    saveState();
    renderLedger();
}

// Food
function spendFoodDay() {
    if(state.food.daysUsed < state.food.daysTotal) {
        pushToUndo();
        state.food.daysUsed++;
        state.food.history.unshift({type:'spend', amt: 30});
        saveState();
        renderLedger();
    }
}

function buyFoodDay() {
    const daysInput = parseFloat(document.getElementById('food-lock-val').value);
    if(!daysInput || daysInput <= 0) return;

    // 1. Calculate Cost based on Base/28
    const fSec = state.strategy.find(s=>s.id==='core_essentials') || state.strategy.find(s=>s.id==='foundations');
    const fItem = fSec ? fSec.items.find(i=>i.label==='Food Base') : null;
    const foodBase = fItem ? fItem.amount : 840;
    const dailyRate = foodBase / 28;
    const totalCost = dailyRate * daysInput;

    pushToUndo();

    // 2. Waterfall Deduction
    let coveredByWeekly = 0;
    let coveredBySurplus = 0;

    if (state.weekly.balance >= totalCost) {
        // Weekly covers it all
        coveredByWeekly = totalCost;
    } else {
        // Weekly covers some, Surplus covers rest
        coveredByWeekly = Math.max(0, state.weekly.balance);
        coveredBySurplus = totalCost - coveredByWeekly;
    }

    // Apply Deductions
    state.weekly.balance -= coveredByWeekly; // Visual limit
    state.balances['Weekly Misc'] -= coveredByWeekly; // Actual ledger
    state.surplus -= coveredBySurplus; // Deficit

    // 3. Add to Visual (Buffer)
    state.food.lockedAmount += totalCost;

    // Log
    state.food.history.unshift({type:'lock', amt: totalCost, label: `+${daysInput} Days`});
    document.getElementById('food-lock-val').value = '';

    saveState();
    renderLedger();
    updateGlobalUI();
}

function releaseAllBuffer() {
    if(state.food.lockedAmount > 0) {
        pushToUndo();
        state.surplus += state.food.lockedAmount;
        state.food.lockedAmount = 0;
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
        state.surplus += h.amt;
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
        state.balances['Weekly Misc'] += (val*dir);
        state.weekly.balance += (val*dir); // Update weekly state
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
        state.surplus -= val;
        state.balances['Weekly Misc'] += val;
        state.weekly.balance += val; // Update weekly state
        logHistory('Weekly Misc', val, 'Top Up');
        document.getElementById('weekly-inline-val').value = '';
        saveState();
        renderLedger();
    }
}

function nextWeek() {
    ensureWeeklyState();
    if (state.weekly.week >= WEEKLY_MAX_WEEKS) {
        alert('Week limit reached. Weekly allowance is capped at 4 weeks.');
        return;
    }

    const weeklyAmt = getWeeklyConfigAmount();

    if(confirm(`Start next week? This will add +${weeklyAmt.toFixed(0)} AED to your weekly allowance.`)) {
        pushToUndo();
        state.weekly.balance += weeklyAmt;
        state.weekly.week += 1;
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
function adjustGlobalSurplus(dir) {
    const val = parseFloat(document.getElementById('surplus-adjust-val').value);
    if(val) {
        const actionLabel = dir > 0 ? 'add' : 'deduct';
        const proceed = confirm(`You are about to ${actionLabel} funds directly to Surplus. This creates or removes money from thin air. Continue?`);
        if (!proceed) return;
        pushToUndo();
        state.surplus += (val*dir);
        document.getElementById('surplus-adjust-val').value = '';
        saveState();
        updateGlobalUI();
    }
}

// Fast Update (Budget Plan) - FIXED: No full re-render on input
function fastUpdateItemAmount(sid, idx, val) {
    const num = parseFloat(val) || 0;
    const sec = state.strategy.find(s => s.id === sid);
    const item = sec.items[idx];

    // Calculate Delta to adjust Surplus
    const oldVal = item.amount;
    const delta = num - oldVal;

    item.amount = num;
    delete item.amortData;

    // Adjust Surplus inversely (Budget UP = Surplus DOWN)
    state.surplus -= delta;

    // Update Balance if it exists
    if(state.balances[item.label] !== undefined) {
        state.balances[item.label] += delta;
    } else {
        state.balances[item.label] = num;
    }

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
            badge.innerText = `${dailyRate.toFixed(2)}/day`;
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
