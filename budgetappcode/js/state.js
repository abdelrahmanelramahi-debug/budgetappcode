// DATA
const ACCOUNT_LABELS = ['General Savings', 'Payables', 'Car Fund', 'Weekly Misc'];

let state = {
    schemaVersion: 2,
    monthlyIncome: 4000,
    settings: {
        currency: 'AED',
        decimals: 2,
        confirmSurplusEdits: true,
        allowNegativeSurplus: true,
        theme: 'light',
        compact: false
    },
    categories: [
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
    accounts: {
        surplus: 0,
        weekly: { balance: 80, week: 1 },
        buckets: {
            'General Savings': 1457,
            'Payables': 0,
            'Car Fund': 500,
            'Weekly Misc': 320
        }
    },
    balances: {
        'Boron Complex': 80, 'Protein': 150, 'Creatine': 100, 'Mg, Sl, Zc': 70,
        'Oats': 60, 'Eggs': 42,
        'Mixed Nuts': 91, 'Misc': 50, 'Hair cut': 35, 'Toilet Paper': 16,
        'Etisalat': 100, 'Tarteel': 35, 'YouTube': 24, 'iCloud': 4, 'Adib': 26
    },
    food: { daysTotal: 28, daysUsed: 0, lockedAmount: 0, history: [] },
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
    migrateState();
    ensureSettings();
}

function migrateState() {
    const schema = state.schemaVersion || 1;
    if (schema >= 2) {
        if (!state.categories && state.strategy) {
            state.categories = state.strategy;
        }
        if (!state.accounts) {
            state.accounts = {
                surplus: state.surplus || 0,
                weekly: state.weekly || { balance: getWeeklyConfigAmount(), week: 1 },
                buckets: {},
                savingsBuckets: {}
            };
        }
        if (!state.accounts.buckets) state.accounts.buckets = {};
        if (!state.accounts.savingsBuckets) {
            const seed = state.accounts.buckets['General Savings'] ?? 0;
            state.accounts.savingsBuckets = { Main: seed };
        }
        if (!state.accounts.savingsDefaultBucket) {
            state.accounts.savingsDefaultBucket = 'Main';
        }
        ACCOUNT_LABELS.forEach(label => {
            if (state.accounts.buckets[label] === undefined) {
                const legacy = state.balances?.[label];
                if (legacy !== undefined) state.accounts.buckets[label] = legacy;
            }
        });
        if (!state.balances) state.balances = {};
        ACCOUNT_LABELS.forEach(label => {
            if (state.balances[label] !== undefined) delete state.balances[label];
        });
        state.schemaVersion = 2;
        return;
    }

    const legacyStrategy = state.strategy || state.categories || [];
    const legacyBalances = state.balances || {};
    const legacyWeekly = state.weekly || { balance: getWeeklyConfigAmount(), week: 1 };

    const buckets = {};
    ACCOUNT_LABELS.forEach(label => {
        const bal = legacyBalances[label];
        if (bal !== undefined) buckets[label] = bal;
    });

    state = {
        ...state,
        schemaVersion: 2,
        categories: legacyStrategy,
        accounts: {
            surplus: state.surplus || 0,
            weekly: legacyWeekly,
            buckets: {
                'General Savings': buckets['General Savings'] ?? 0,
                'Payables': buckets['Payables'] ?? 0,
                'Car Fund': buckets['Car Fund'] ?? 0,
                'Weekly Misc': buckets['Weekly Misc'] ?? 0
            },
            savingsBuckets: {
                Main: buckets['General Savings'] ?? 0
            },
            savingsDefaultBucket: 'Main'
        },
        balances: Object.keys(legacyBalances).reduce((acc, key) => {
            if (!ACCOUNT_LABELS.includes(key)) acc[key] = legacyBalances[key];
            return acc;
        }, {}),
        food: state.food || { daysTotal: 28, daysUsed: 0, lockedAmount: 0, history: [] },
        histories: state.histories || {}
    };
}

function isAccountLabel(label) {
    return ACCOUNT_LABELS.includes(label);
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
    let sys = state.categories.find(s => s.id === 'sys_savings');
    if(!sys) {
        state.categories.unshift({
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
    let core = state.categories.find(s => s.id === 'core_essentials');

    if (!core) {
        state.categories.splice(1, 0, {
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

    state.categories.forEach(sec => {
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
    const misc = state.categories.find(s=>s.id==='core_essentials')?.items.find(i=>i.label==='Weekly Misc');
    const fullAmt = misc ? misc.amount : 320;
    return fullAmt / 4;
}

function ensureWeeklyState() {
    const weeklyAmt = getWeeklyConfigAmount();
    if (!state.accounts) {
        state.accounts = { surplus: 0, weekly: { balance: weeklyAmt, week: 1 }, buckets: {} };
    }
    if (!state.accounts.weekly) {
        state.accounts.weekly = { balance: weeklyAmt, week: 1 };
    }
    if (typeof state.accounts.weekly.balance !== 'number' || Number.isNaN(state.accounts.weekly.balance)) {
        state.accounts.weekly.balance = weeklyAmt;
    }
    if (typeof state.accounts.weekly.week !== 'number' || Number.isNaN(state.accounts.weekly.week)) {
        state.accounts.weekly.week = 1;
    }
    state.accounts.weekly.week = Math.min(WEEKLY_MAX_WEEKS, Math.max(1, Math.round(state.accounts.weekly.week)));
}

function getFoodRemainderInfo() {
    const fSec = state.categories.find(s=>s.id==='core_essentials') || state.categories.find(s=>s.id==='foundations');
    const fItem = fSec ? fSec.items.find(i=>i.label==='Food Base') : null;
    const foodBase = fItem ? fItem.amount : 0;
    const daysLeft = state.food.daysTotal - state.food.daysUsed;
    const dailyRate = state.food.daysTotal > 0 ? (foodBase / state.food.daysTotal) : 0;
    const remainder = daysLeft * dailyRate;
    return { fItem, foodBase, daysLeft, dailyRate, remainder };
}

function initSurplusFromOpening() {
    let allocated = 0;
    if (!state.accounts) {
        state.accounts = { surplus: 0, weekly: { balance: getWeeklyConfigAmount(), week: 1 }, buckets: {} };
    }
    if (!state.accounts.buckets) state.accounts.buckets = {};
    if (!state.accounts.savingsBuckets) {
        state.accounts.savingsBuckets = { Main: state.accounts.buckets['General Savings'] ?? 0 };
    }
    if (!state.accounts.savingsDefaultBucket) {
        state.accounts.savingsDefaultBucket = 'Main';
    }

    state.categories.forEach(sec => {
        sec.items.forEach(item => {
            allocated += item.amount;
            if (isAccountLabel(item.label)) {
                if (state.accounts.buckets[item.label] === undefined) {
                    state.accounts.buckets[item.label] = item.amount;
                }
            } else if(state.balances[item.label] === undefined) {
                state.balances[item.label] = item.amount;
            }
        });
    });
    state.accounts.surplus = state.monthlyIncome - allocated;
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
