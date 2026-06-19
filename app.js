/* ============================================================
   হিসাবকিতাব - PWA App Logic
   IndexedDB + Google Sheets Sync + SMS via Twilio
   ============================================================ */

// ===== CONFIG (loaded from localStorage) =====
let CONFIG = {
  gasUrl: '',      // Google Apps Script Web App URL
  twilioSid: '',
  twilioToken: '',
  twilioFrom: ''
};

function loadConfig() {
  const saved = localStorage.getItem('hisab_config');
  if (saved) CONFIG = { ...CONFIG, ...JSON.parse(saved) };
}

function saveSettings() {
  CONFIG.gasUrl = document.getElementById('gasUrl').value.trim();
  CONFIG.twilioSid = document.getElementById('twilioSid').value.trim();
  CONFIG.twilioToken = document.getElementById('twilioToken').value.trim();
  CONFIG.twilioFrom = document.getElementById('twilioFrom').value.trim();
  localStorage.setItem('hisab_config', JSON.stringify(CONFIG));
  closeSettings();
  showToast('সেটিংস সেভ হয়েছে ✓', 'success');
}

function openSettings() {
  loadConfig();
  document.getElementById('gasUrl').value = CONFIG.gasUrl;
  document.getElementById('twilioSid').value = CONFIG.twilioSid;
  document.getElementById('twilioToken').value = CONFIG.twilioToken;
  document.getElementById('twilioFrom').value = CONFIG.twilioFrom;
  document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

// ===== INDEXEDDB =====
let db;
const DB_NAME = 'hisabkitab';
const DB_VERSION = 1;

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('transactions')) {
        const txStore = d.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        txStore.createIndex('synced', 'synced', { unique: false });
        txStore.createIndex('category', 'category', { unique: false });
        txStore.createIndex('datetime', 'datetime', { unique: false });
      }
      if (!d.objectStoreNames.contains('network')) {
        const nwStore = d.createObjectStore('network', { keyPath: 'phone' });
        nwStore.createIndex('name', 'name', { unique: false });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function dbAdd(store, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(store, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbUpdate(store, id, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objStore = tx.objectStore(store);
    const getReq = objStore.get(id);
    getReq.onsuccess = () => {
      const updated = { ...getReq.result, ...data };
      const putReq = objStore.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
  });
}

// ===== CATEGORIES =====
const LOAN_CATEGORIES = ['Giving Loan', 'Taking Loan', 'Loan Paid', 'Credit Purchase', 'Credit Purchase Loan Paid', 'Loan repaid'];
const SMS_CATEGORIES = ['Giving Loan', 'Taking Loan', 'Loan Paid', 'Credit Purchase', 'Credit Purchase Loan Paid', 'Loan repaid'];
const INCOME_CATEGORIES = ['Paycheck', 'Taking Loan', 'Loan repaid'];
const EXPENSE_CATEGORIES = ['Food', 'Gifts', 'Health/Medical', 'Bike Cost', 'Transportation', 'Personal', 'Net & Electricity Bill', 'Travel', 'Donate', 'Savings', 'Other', 'Giving Loan', 'Loan Paid', 'Credit Purchase', 'Credit Purchase Loan Paid'];

const CATEGORY_ICONS = {
  'Food': '🍚', 'Gifts': '🎁', 'Health/Medical': '🏥', 'Bike Cost': '🏍',
  'Transportation': '🚌', 'Personal': '👤', 'Net & Electricity Bill': '💡',
  'Travel': '✈️', 'Donate': '🤲', 'Savings': '🐖', 'Other': '📦',
  'Paycheck': '💰', 'Giving Loan': '💸', 'Taking Loan': '🤝',
  'Loan Paid': '✅', 'Loan repaid': '🔄', 'Credit Purchase': '🛒',
  'Credit Purchase Loan Paid': '✔️'
};

// ===== FORM LOGIC =====
function onCategoryChange() {
  const cat = document.getElementById('category').value;
  const isLoan = LOAN_CATEGORIES.includes(cat);
  const isSMS = SMS_CATEGORIES.includes(cat);

  document.getElementById('phoneGroup').style.display = isLoan ? 'block' : 'none';
  document.getElementById('nameGroup').style.display = isLoan ? 'block' : 'none';
  document.getElementById('smsSection').style.display = isSMS ? 'block' : 'none';

  if (!isLoan) {
    document.getElementById('phone').value = '';
    document.getElementById('name').value = '';
    document.getElementById('autofillTag').style.display = 'none';
  }

  updateSmsPreview();
  updatePartialInfo();
}

async function onPhoneInput() {
  clearTimeout(window._phoneTimer);
  window._phoneTimer = setTimeout(lookupPhone, 800);
}

async function lookupPhone() {
  const phone = document.getElementById('phone').value.trim();
  if (!phone || phone.length < 10) return;

  // Check local DB first
  const contact = await dbGet('network', phone);
  if (contact) {
    document.getElementById('name').value = contact.name;
    document.getElementById('autofillTag').style.display = 'block';
    updateSmsPreview();
    updatePartialInfo();
    return;
  }

  // Check Google Sheets (online)
  if (navigator.onLine && CONFIG.gasUrl) {
    try {
      const res = await fetch(`${CONFIG.gasUrl}?action=lookupPhone&phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (data.name) {
        document.getElementById('name').value = data.name;
        document.getElementById('autofillTag').style.display = 'block';
        await dbPut('network', { phone, name: data.name });
        updateSmsPreview();
        updatePartialInfo();
        return;
      }
    } catch (e) { /* offline fallback */ }
  }

  document.getElementById('autofillTag').style.display = 'none';
}

function updateSmsPreview() {
  const cat = document.getElementById('category').value;
  const name = document.getElementById('name').value;
  const take = parseFloat(document.getElementById('takeAmount').value) || 0;
  const give = parseFloat(document.getElementById('giveAmount').value) || 0;
  const preview = document.getElementById('smsPreview');

  if (!cat || !SMS_CATEGORIES.includes(cat)) { preview.style.display = 'none'; return; }

  let msg = generateSmsText(cat, name, take, give, 0, 0);
  preview.textContent = '📱 ' + msg;
  preview.style.display = document.getElementById('sendSms').checked ? 'block' : 'none';
}

function generateSmsText(cat, name, take, give, totalAmt, remainingAmt) {
  // SMS যাবে অপর পক্ষের কাছে — তাই তার দৃষ্টিকোণ থেকে লেখা
  const amt = take || give;
  let msg = '';

  if (cat === 'Giving Loan') {
    // আমি তাকে লোন দিয়েছি → সে পেয়েছে
    msg = `আপনি ${name} এর কাছ থেকে ${amt} টাকা লোন পেয়েছেন। অনুগ্রহ করে সময়মতো পরিশোধ করবেন।`;
  }
  else if (cat === 'Taking Loan') {
    // আমি তার কাছ থেকে লোন নিয়েছি → সে দিয়েছে
    msg = `আপনি ${name} কে ${amt} টাকা লোন দিয়েছেন।`;
  }
  else if (cat === 'Loan Paid') {
    // আমি তার লোন শোধ করলাম → সে জানুক টাকা পেয়েছে
    msg = `${name} আপনার লোনের ${give} টাকা পরিশোধ করেছেন। বাকি আছে ${remainingAmt} টাকা।`;
  }
  else if (cat === 'Loan repaid') {
    // সে আমার লোন ফেরত দিল → সে জানুক দেওয়া হয়েছে
    msg = `আপনি ${name} কে ${give} টাকা ফেরত দিয়েছেন। বাকি আছে ${remainingAmt} টাকা।`;
  }
  else if (cat === 'Credit Purchase') {
    // আমি তার কাছ থেকে বাকি কিনলাম → সে জানুক তার পাওনা হয়েছে
    msg = `${name} আপনার কাছ থেকে ${amt} টাকার পণ্য বাকিতে নিয়েছেন।`;
  }
  else if (cat === 'Credit Purchase Loan Paid') {
    // আমি বাকি শোধ করলাম → সে জানুক টাকা পেয়েছে
    msg = `${name} আপনার বাকির ${give} টাকা পরিশোধ করেছেন। বাকি আছে ${remainingAmt} টাকা।`;
  }

  return msg;
}

async function updatePartialInfo() {
  const cat = document.getElementById('category').value;
  const phone = document.getElementById('phone').value.trim();
  const partial = document.getElementById('partialSection');

  const paymentCats = ['Loan Paid', 'Loan repaid', 'Credit Purchase Loan Paid'];
  if (!paymentCats.includes(cat) || !phone) { partial.style.display = 'none'; return; }

  // Calculate from local DB
  const all = await dbGetAll('transactions');
  let total = 0, paid = 0;

  all.filter(t => t.phone === phone).forEach(t => {
    if (t.category === 'Giving Loan' || t.category === 'Credit Purchase') total += (t.takeAmount || 0) + (t.giveAmount || 0);
    if (t.category === 'Taking Loan') total += (t.takeAmount || 0);
    if (t.category === 'Loan Paid' || t.category === 'Credit Purchase Loan Paid') paid += (t.giveAmount || 0);
    if (t.category === 'Loan repaid') paid += (t.giveAmount || 0);
  });

  const remaining = Math.max(0, total - paid);
  document.getElementById('totalLoanAmt').textContent = `৳ ${total.toFixed(0)}`;
  document.getElementById('paidLoanAmt').textContent = `৳ ${paid.toFixed(0)}`;
  document.getElementById('remainingLoanAmt').textContent = `৳ ${remaining.toFixed(0)}`;
  partial.style.display = 'block';
}

// ===== FORM SUBMIT =====
document.getElementById('transactionForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const cat = document.getElementById('category').value;
  const phone = document.getElementById('phone').value.trim();
  const name = document.getElementById('name').value.trim();
  const take = parseFloat(document.getElementById('takeAmount').value) || 0;
  const give = parseFloat(document.getElementById('giveAmount').value) || 0;
  const reason = document.getElementById('reason').value.trim();
  const sendSms = document.getElementById('sendSms').checked;

  // Validations
  if (!cat) { showToast('ক্যাটাগরি বেছে নিন!', 'error'); return; }
  if (LOAN_CATEGORIES.includes(cat) && !phone) { showToast('ফোন নম্বর দিন!', 'error'); return; }
  if (LOAN_CATEGORIES.includes(cat) && !name) { showToast('নাম দিন!', 'error'); return; }
  if (!take && !give) { showToast('পরিমাণ দিন!', 'error'); return; }

  const transaction = {
    datetime: new Date().toISOString(),
    category: cat,
    name,
    phone,
    takeAmount: take,
    giveAmount: give,
    reason,
    synced: false,
    createdAt: Date.now()
  };

  // Save to IndexedDB
  const id = await dbAdd('transactions', transaction);
  transaction.id = id;

  // Save new contact if provided
  if (phone && name) {
    const existing = await dbGet('network', phone);
    if (!existing) {
      await dbPut('network', { phone, name });
      // Sync contact to Google Sheets
      if (navigator.onLine && CONFIG.gasUrl) {
        fetch(`${CONFIG.gasUrl}?action=saveContact&phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`).catch(() => {});
      }
    }
  }

  // Send SMS if requested
  if (sendSms && SMS_CATEGORIES.includes(cat)) {
    const all = await dbGetAll('transactions');
    let remaining = 0;
    if (['Loan Paid', 'Loan repaid', 'Credit Purchase Loan Paid'].includes(cat)) {
      let tot = 0, pd = 0;
      all.filter(t => t.phone === phone).forEach(t => {
        if (t.category === 'Giving Loan' || t.category === 'Credit Purchase') tot += (t.takeAmount || 0) + (t.giveAmount || 0);
        if (t.category === 'Taking Loan') tot += (t.takeAmount || 0);
        if (['Loan Paid', 'Credit Purchase Loan Paid', 'Loan repaid'].includes(t.category)) pd += (t.giveAmount || 0);
      });
      remaining = Math.max(0, tot - pd);
    }
    const smsText = generateSmsText(cat, name, take, give, 0, remaining);
    await sendSmsMessage(phone, smsText);
  }

  // Reset form
  document.getElementById('transactionForm').reset();
  onCategoryChange();
  document.getElementById('autofillTag').style.display = 'none';

  showToast('লেনদেন সেভ হয়েছে ✓', 'success');
  updateBalance();
  updatePendingBadge();

  // Try sync
  if (navigator.onLine) syncNow();
});

// ===== SMS =====
async function sendSmsMessage(toPhone, message) {
  if (!CONFIG.twilioSid || !CONFIG.twilioToken || !CONFIG.twilioFrom) {
    showToast('Twilio কনফিগার করুন!', 'error');
    return;
  }
  // Format BD number
  let formatted = toPhone.replace(/\D/g, '');
  if (formatted.startsWith('0')) formatted = '+88' + formatted;
  else if (!formatted.startsWith('+')) formatted = '+88' + formatted;

  try {
    const auth = btoa(`${CONFIG.twilioSid}:${CONFIG.twilioToken}`);
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${CONFIG.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ From: CONFIG.twilioFrom, To: formatted, Body: message })
    });
    showToast('SMS পাঠানো হয়েছে ✓', 'success');
  } catch {
    showToast('SMS পাঠানো যায়নি', 'error');
  }
}

// ===== SYNC =====
async function syncNow() {
  if (!navigator.onLine || !CONFIG.gasUrl) return;

  const all = await dbGetAll('transactions');
  const unsynced = all.filter(t => !t.synced);
  if (!unsynced.length) return;

  updateSyncStatus('syncing');

  let synced = 0;
  for (const t of unsynced) {
    try {
      const params = new URLSearchParams({
        action: 'addExpense',
        datetime: t.datetime,
        category: t.category,
        name: t.name || '',
        phone: t.phone || '',
        takeAmount: t.takeAmount || 0,
        giveAmount: t.giveAmount || 0,
        reason: t.reason || ''
      });
      const res = await fetch(`${CONFIG.gasUrl}?${params}`);
      const data = await res.json();
      if (data.status === 'ok') {
        await dbUpdate('transactions', t.id, { synced: true });
        synced++;
      }
    } catch { /* will retry next time */ }
  }

  if (synced > 0) {
    showToast(`${synced}টি লেনদেন সিঙ্ক হয়েছে ✓`, 'success');
    updatePendingBadge();
    renderPending();
  }

  updateSyncStatus(navigator.onLine ? 'online' : 'offline');
}

// ===== NETWORK STATUS =====
function updateSyncStatus(state) {
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncLabel');
  dot.className = 'sync-dot ' + state;
  if (state === 'online') label.textContent = 'অনলাইন';
  else if (state === 'offline') label.textContent = 'অফলাইন';
  else label.textContent = 'সিঙ্ক হচ্ছে...';
}

window.addEventListener('online', () => { updateSyncStatus('online'); syncNow(); });
window.addEventListener('offline', () => updateSyncStatus('offline'));

// ===== BALANCE =====
async function updateBalance() {
  const all = await dbGetAll('transactions');
  const monthSel = document.getElementById('monthFilter').value;
  const filtered = filterByMonth(all, monthSel);

  let income = 0, expense = 0;
  filtered.forEach(t => {
    income += t.takeAmount || 0;
    expense += t.giveAmount || 0;
  });

  const balance = income - expense;
  document.getElementById('totalBalance').textContent = `৳ ${formatNum(balance)}`;
  document.getElementById('totalIncome').textContent = `৳ ${formatNum(income)}`;
  document.getElementById('totalExpense').textContent = `৳ ${formatNum(expense)}`;
}

function filterByMonth(list, monthVal) {
  if (monthVal === 'all') return list;
  return list.filter(t => {
    const d = new Date(t.datetime);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === monthVal;
  });
}

function formatNum(n) {
  return Math.abs(n) >= 1000 ? n.toLocaleString('en-BD') : n.toFixed(0);
}

// ===== MONTH FILTER =====
async function populateMonthFilters() {
  const all = await dbGetAll('transactions');
  const months = new Set();
  all.forEach(t => {
    const d = new Date(t.datetime);
    months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  });

  const sorted = [...months].sort().reverse();
  const monthNames = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];

  [document.getElementById('monthFilter'), document.getElementById('historyMonthFilter')].forEach(sel => {
    const cur = sel.value;
    // Clear all except 'all'
    while (sel.options.length > 1) sel.remove(1);
    sorted.forEach(m => {
      const [y, mo] = m.split('-');
      const opt = new Option(`${monthNames[parseInt(mo)-1]} ${y}`, m);
      sel.add(opt);
    });
    sel.value = cur;
  });
}

// ===== HISTORY =====
async function renderHistory() {
  const all = await dbGetAll('transactions');
  const monthSel = document.getElementById('historyMonthFilter').value;
  const filtered = filterByMonth(all, monthSel).sort((a,b) => b.createdAt - a.createdAt);

  const container = document.getElementById('historyList');
  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div>কোনো লেনদেন নেই</div></div>';
    return;
  }

  container.innerHTML = filtered.map(t => {
    const icon = CATEGORY_ICONS[t.category] || '📌';
    const amtTake = t.takeAmount ? `<div class="amt-take">+৳${formatNum(t.takeAmount)}</div>` : '';
    const amtGive = t.giveAmount ? `<div class="amt-give">-৳${formatNum(t.giveAmount)}</div>` : '';
    const dt = new Date(t.datetime);
    const dateStr = `${dt.getDate()}/${dt.getMonth()+1}/${dt.getFullYear()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2,'0')}`;
    const sub = [t.name, t.phone, t.reason].filter(Boolean).join(' · ');
    const pendingDot = !t.synced ? '<div class="pending-dot"></div>' : '';
    return `<div class="history-item">
      <div class="history-icon ${t.takeAmount ? 'take' : 'give'}">${icon}</div>
      <div class="history-meta">
        <div class="history-cat">${t.category}</div>
        <div class="history-sub">${sub || '—'}</div>
      </div>
      <div class="history-amt">
        ${amtTake}${amtGive}
        <div class="history-date">${dateStr}</div>
      </div>
      ${pendingDot}
    </div>`;
  }).join('');
}

// ===== PENDING =====
async function updatePendingBadge() {
  const all = await dbGetAll('transactions');
  const count = all.filter(t => !t.synced).length;
  const badge = document.getElementById('pendingBadge');
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

async function renderPending() {
  const all = await dbGetAll('transactions');
  const unsynced = all.filter(t => !t.synced).sort((a,b) => b.createdAt - a.createdAt);
  const container = document.getElementById('pendingList');

  if (!unsynced.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div>সব সিঙ্ক হয়ে গেছে</div></div>';
    return;
  }

  container.innerHTML = unsynced.map(t => {
    const icon = CATEGORY_ICONS[t.category] || '📌';
    const dt = new Date(t.datetime);
    const dateStr = `${dt.getDate()}/${dt.getMonth()+1} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2,'0')}`;
    const amt = t.takeAmount ? `+৳${t.takeAmount}` : `-৳${t.giveAmount}`;
    return `<div class="history-item">
      <div class="pending-dot"></div>
      <div class="history-icon">${icon}</div>
      <div class="history-meta">
        <div class="history-cat">${t.category}</div>
        <div class="history-sub">${t.name || ''}</div>
      </div>
      <div class="history-amt">
        <div style="color:var(--warn)">${amt}</div>
        <div class="history-date">${dateStr}</div>
      </div>
    </div>`;
  }).join('');
}

// ===== LOANS =====
let currentLoanTab = 'receivable';

function switchLoanTab(tab) {
  currentLoanTab = tab;
  document.querySelectorAll('.loan-tab-btn').forEach((b, i) => {
    b.classList.toggle('active', ['receivable', 'payable', 'credit'][i] === tab);
  });
  renderLoans();
}

async function renderLoans() {
  const all = await dbGetAll('transactions');
  const network = await dbGetAll('network');
  const container = document.getElementById('loanContent');

  // Build contact summary
  const contactMap = {};

  all.forEach(t => {
    if (!t.phone) return;
    if (!contactMap[t.phone]) contactMap[t.phone] = { name: t.name, phone: t.phone, givingLoan: 0, takingLoan: 0, loanPaid: 0, loanRepaid: 0, creditPurchase: 0, creditPaid: 0 };
    const c = contactMap[t.phone];
    if (t.category === 'Giving Loan') c.givingLoan += (t.takeAmount || 0) + (t.giveAmount || 0);
    if (t.category === 'Taking Loan') c.takingLoan += (t.takeAmount || 0) + (t.giveAmount || 0);
    if (t.category === 'Loan Paid') c.loanPaid += (t.giveAmount || 0);
    if (t.category === 'Loan repaid') c.loanRepaid += (t.giveAmount || 0);
    if (t.category === 'Credit Purchase') c.creditPurchase += (t.takeAmount || 0) + (t.giveAmount || 0);
    if (t.category === 'Credit Purchase Loan Paid') c.creditPaid += (t.giveAmount || 0);
  });

  let cards = [];

  if (currentLoanTab === 'receivable') {
    // Giving Loan - loan given out, expect repayment
    Object.values(contactMap).forEach(c => {
      const total = c.givingLoan;
      if (total === 0) return;
      const paid = c.loanRepaid;
      const remaining = Math.max(0, total - paid);
      if (remaining <= 0 && total === 0) return;
      cards.push({ ...c, total, paid, remaining, label: 'লোন দিয়েছি' });
    });
  } else if (currentLoanTab === 'payable') {
    // Taking Loan - loan taken, need to repay
    Object.values(contactMap).forEach(c => {
      const total = c.takingLoan;
      if (total === 0) return;
      const paid = c.loanPaid;
      const remaining = Math.max(0, total - paid);
      cards.push({ ...c, total, paid, remaining, label: 'লোন নিয়েছি' });
    });
  } else {
    // Credit purchase
    Object.values(contactMap).forEach(c => {
      const total = c.creditPurchase;
      if (total === 0) return;
      const paid = c.creditPaid;
      const remaining = Math.max(0, total - paid);
      cards.push({ ...c, total, paid, remaining, label: 'বাকি কেনা' });
    });
  }

  if (!cards.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">💳</div><div>কোনো তথ্য নেই</div></div>';
    return;
  }

  container.innerHTML = cards.map(c => `
    <div class="loan-contact-card">
      <div class="loan-contact-name">${c.name}</div>
      <div class="loan-contact-phone">${c.phone} · ${c.label}</div>
      <div class="loan-amounts">
        <div class="loan-amt-block">
          <div class="loan-amt-label">মোট</div>
          <div class="loan-amt-val total">৳${formatNum(c.total)}</div>
        </div>
        <div class="loan-amt-block">
          <div class="loan-amt-label">পরিশোধ</div>
          <div class="loan-amt-val paid">৳${formatNum(c.paid)}</div>
        </div>
        <div class="loan-amt-block">
          <div class="loan-amt-label">বাকি</div>
          <div class="loan-amt-val remaining">৳${formatNum(c.remaining)}</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ===== TABS =====
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  if (tab === 'history') { populateMonthFilters(); renderHistory(); }
  if (tab === 'loans') renderLoans();
  if (tab === 'pending') renderPending();
}

// ===== TOAST =====
let toastTimer;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast', 3000);
}

// ===== SMS TOGGLE LIVE UPDATE =====
document.getElementById('sendSms').addEventListener('change', updateSmsPreview);
document.getElementById('takeAmount').addEventListener('input', updateSmsPreview);
document.getElementById('giveAmount').addEventListener('input', updateSmsPreview);
document.getElementById('name').addEventListener('input', updateSmsPreview);

// Month filter for balance
document.getElementById('monthFilter').addEventListener('change', updateBalance);

// ===== INIT =====
async function init() {
  loadConfig();
  await initDB();
  updateSyncStatus(navigator.onLine ? 'online' : 'offline');
  await populateMonthFilters();
  await updateBalance();
  await updatePendingBadge();

  if (navigator.onLine) syncNow();

  // Auto-sync every 30 seconds
  setInterval(() => { if (navigator.onLine) syncNow(); }, 30000);
}

init();

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
