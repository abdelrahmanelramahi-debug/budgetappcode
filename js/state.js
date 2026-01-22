// DATA
let state = {
    monthlyIncome: 4000,
    settings: {
        currency: 'AED',
        decimals: 2,
        confirmSurplusEdits: true,
        allowNegativeSurplus: true,
        theme: 'light',
        compact: false
    },
    strategy: [
        { id: 'sys_savings', label: 'System Savings', isSystem: true, items: [
            { label: 'General Savings', amount: 1457, isAutoCalculated: false },
            { label: 'Payables', amount: 0, isAutoCalculated: false }
        ] },
        { id: 'core_essentials', label: 'Core Essentials', isSystem: true, items: [
            { label: 'Weekly Misc', amount: 320, isCore: true },
            { label: 'Food Base', amount: 840, isCore: true },
            { label: 'Car Fund', amount: 500, isCore: true }
        ]},
        { id: 'health', label: 'Health', isLedgerLinked: true, isSingleAction: true, items: [
            { label: 'Boron Complex', amount: 80 },
            { label: 'Protein', amount: 150 },
            { label: 'Creatine', amount: 100 },
            { label: 'Mg, Sl, Zc', amount: 70 }
        ]},
        { id: 'groceries', label: 'Groceries', isLedgerLinked: true, isSingleAction: true, items: [
            { label: 'Oats', amount: 60 },
            { label: 'Eggs', amount: 42 }
        ]},
        { id: 'misc', label: 'Misc', isLedgerLinked: true, isSingleAction: true, items: [
            { label: 'Mixed Nuts', amount: 91 },
            { label: 'Misc', amount: 50 },
            { label: 'Hair cut', amount: 35 },
            { label: 'Toilet Paper', amount: 16 }
        ]},
        { id: 'subscriptions', label: 'Subscriptions', isLedgerLinked: true, isSingleAction: true, items: [
            { label: 'Etisalat', amount: 100 },
            { label: 'Tarteel', amount: 35 },
            { label: 'YouTube', amount: 24 },
            { label: 'iCloud', amount: 4 },
            { label: 'Adib', amount: 26 }
        ]}
    ],
    balances: {
        'Weekly Misc': 320, 'Car Fund': 500,
        'Boron Complex': 80, 'Protein': 150, 'Creatine': 100, 'Mg, Sl, Zc': 70,
        'Oats': 60, 'Eggs': 42,
        'Mixed Nuts': 91, 'Misc': 50, 'Hair cut': 35, 'Toilet Paper': 16,
        'Etisalat': 100, 'Tarteel': 35, 'YouTube': 24, 'iCloud': 4, 'Adib': 26,
        'General Savings': 1457,
        'Payables': 0
    },
    food: { daysTotal: 28, daysUsed: 0, lockedAmount: 0, history: [] },
    weekly: { balance: 80, week: 1 },
    surplus: 0,
    histories: {}
};

// GLOBAL VARS
let dragSrc = null;
let dragType = null;
let currentAddSectionId = null;
let itemToDelete = null;
let currentAmort = { sid: null, idx: null };
let activeCat = null;
let undoStack = [];

const WEEKLY_MAX_WEEKS = 4;

let pendingDangerAction = null;
let requiredDangerPhrase = "";

// PERSISTENCE
function saveState() {
    localStorage.setItem('financeCmd_state', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('financeCmd_state');
    if (saved) {
        try {
            const loaded = JSON.parse(saved);
            state = { ...state, ...loaded };
            if(typeof state.monthlyIncome === 'undefined') state.monthlyIncome = 4000;
        } catch(e) { console.error("Save data corrupt, using default"); }
    }
    ensureSettings();
}

function ensureSettings() {
    const defaults = {
        currency: 'AED',
        decimals: 2,
        confirmSurplusEdits: true,
        allowNegativeSurplus: true,
        theme: 'light',
        compact: false
    };
    if(!state.settings) state.settings = { ...defaults };
    state.settings = { ...defaults, ...state.settings };
    if (typeof state.settings.decimals !== 'number' || Number.isNaN(state.settings.decimals)) {
        state.settings.decimals = 2;
    }
}

function ensureSystemSavings() {
    let sys = state.strategy.find(s => s.id === 'sys_savings');
    if(!sys) {
        state.strategy.unshift({
            id: 'sys_savings',
            label: 'System Savings',
            isSystem: true,
            items: [
                { label: 'General Savings', amount: 1457, isAutoCalculated: false },
                { label: 'Payables', amount: 0, isAutoCalculated: false }
            ]
        });
    } else {
        const savings = sys.items.find(i => i.label === 'General Savings');
        if (!savings) {
            sys.items.unshift({ label: 'General Savings', amount: 1457, isAutoCalculated: false });
        }
        const payables = sys.items.find(i => i.label === 'Payables');
        if (!payables) {
            sys.items.push({ label: 'Payables', amount: 0, isAutoCalculated: false });
        }
    }
}

function ensureCoreItems() {
    let core = state.strategy.find(s => s.id === 'core_essentials');

    if (!core) {
        state.strategy.splice(1, 0, {
            id: 'core_essentials',
            label: 'Core Essentials',
            isSystem: true,
            items: [
                { label: 'Weekly Misc', amount: 320, isCore: true },
                { label: 'Food Base', amount: 840, isCore: true },
                { label: 'Car Fund', amount: 500, isCore: true }
            ]
        });
    } else {
        const car = core.items.find(i => i.label === 'Car Fund');
        if (!car) {
            core.items.push({ label: 'Car Fund', amount: 500, isCore: true });
        }
    }

    state.strategy.forEach(sec => {
        if (sec.id !== 'core_essentials') {
            sec.items = sec.items.filter(i =>
                i.label !== 'Weekly Misc' &&
                i.label !== 'Food Base' &&
                i.label !== 'Car Fund'
            );
        }
    });
}

function getWeeklyConfigAmount() {
    const misc = state.strategy.find(s=>s.id==='core_essentials')?.items.find(i=>i.label==='Weekly Misc');
    const fullAmt = misc ? misc.amount : 320;
    return fullAmt / 4;
}

function ensureWeeklyState() {
    const weeklyAmt = getWeeklyConfigAmount();
    if (!state.weekly) {
        state.weekly = { balance: weeklyAmt, week: 1 };
    }
    if (typeof state.weekly.balance !== 'number' || Number.isNaN(state.weekly.balance)) {
        state.weekly.balance = weeklyAmt;
    }
    if (typeof state.weekly.week !== 'number' || Number.isNaN(state.weekly.week)) {
        state.weekly.week = 1;
    }
    state.weekly.week = Math.min(WEEKLY_MAX_WEEKS, Math.max(1, Math.round(state.weekly.week)));
}

function getFoodRemainderInfo() {
    const fSec = state.strategy.find(s=>s.id==='core_essentials') || state.strategy.find(s=>s.id==='foundations');
    const fItem = fSec ? fSec.items.find(i=>i.label==='Food Base') : null;
    const foodBase = fItem ? fItem.amount : 0;
    const daysLeft = state.food.daysTotal - state.food.daysUsed;
    const dailyRate = state.food.daysTotal > 0 ? (foodBase / state.food.daysTotal) : 0;
    const remainder = daysLeft * dailyRate;
    return { fItem, foodBase, daysLeft, dailyRate, remainder };
}

function initSurplusFromOpening() {
    let allocated = 0;
    state.strategy.forEach(sec => {
        sec.items.forEach(item => {
            allocated += item.amount;
            if(state.balances[item.label] === undefined) {
                state.balances[item.label] = item.amount;
            }
        });
    });
    state.surplus = state.monthlyIncome - allocated;
}

// UNDO SYSTEM
function pushToUndo() {
    if (undoStack.length > 50) undoStack.shift();
    undoStack.push(JSON.stringify(state));
    updateUndoButtonUI();
}

function globalUndo() {
    if (undoStack.length === 0) return;
    const prevState = undoStack.pop();
    state = JSON.parse(prevState);
    saveState();
    renderLedger();
    renderStrategy();
    updateUndoButtonUI();
    document.querySelectorAll('.modal-overlay').forEach(el => toggleModal(el.id, false));
}

function updateUndoButtonUI() {
    const btn = document.getElementById('global-undo-btn');
    if(btn) {
        if(undoStack.length > 0) {
            btn.classList.remove('opacity-30', 'pointer-events-none');
        } else {
            btn.classList.add('opacity-30', 'pointer-events-none');
        }
    }
}

function logHistory(cat, amt, res) {
    if(!state.histories[cat]) state.histories[cat] = [];
    state.histories[cat].unshift({amt, res, time: 'Now'});
}
