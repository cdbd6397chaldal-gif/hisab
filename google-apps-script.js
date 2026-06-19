/**
 * হিসাবকিতাব - Google Apps Script Backend
 * 
 * HOW TO DEPLOY:
 * 1. Google Sheets-এ যান (Expenses + Network শিট তৈরি করুন)
 * 2. Extensions > Apps Script-এ যান
 * 3. এই কোড পেস্ট করুন
 * 4. Deploy > New deployment > Web App হিসেবে পাবলিশ করুন
 * 5. "Who has access" = Anyone তে সেট করুন
 * 6. Web App URL টি কপি করে অ্যাপের সেটিংসে দিন
 * 
 * SHEET STRUCTURE:
 * Sheet 1: "Expenses"  - A:DateTime, B:Category, C:Name, D:Phone, E:TakeAmount, F:GiveAmount, G:Reason
 * Sheet 2: "Network"   - A:Name, B:Phone
 */

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doGet(e) {
  const action = e.parameter.action;
  
  try {
    if (action === 'addExpense') return addExpense(e.parameter);
    if (action === 'lookupPhone') return lookupPhone(e.parameter.phone);
    if (action === 'saveContact') return saveContact(e.parameter.name, e.parameter.phone);
    if (action === 'getExpenses') return getExpenses();
    if (action === 'getNetwork') return getNetwork();
    
    return jsonResponse({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function addExpense(params) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Expenses');
  if (!sheet) {
    sheet = ss.insertSheet('Expenses');
    sheet.appendRow(['Date Time', 'Category', 'Name', 'Phone Number', 'Take Amount', 'Give Amount', 'Reason']);
  }
  
  sheet.appendRow([
    params.datetime || new Date().toISOString(),
    params.category || '',
    params.name || '',
    params.phone || '',
    parseFloat(params.takeAmount) || 0,
    parseFloat(params.giveAmount) || 0,
    params.reason || ''
  ]);
  
  return jsonResponse({ status: 'ok' });
}

function lookupPhone(phone) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Network');
  if (!sheet) return jsonResponse({ name: null });
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == phone) {
      return jsonResponse({ name: data[i][0] });
    }
  }
  return jsonResponse({ name: null });
}

function saveContact(name, phone) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Network');
  if (!sheet) {
    sheet = ss.insertSheet('Network');
    sheet.appendRow(['Name', 'Phone Number']);
  }
  
  // Check if exists
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == phone) return jsonResponse({ status: 'exists' });
  }
  
  sheet.appendRow([name, phone]);
  return jsonResponse({ status: 'ok' });
}

function getExpenses() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Expenses');
  if (!sheet) return jsonResponse({ data: [] });
  
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  
  return jsonResponse({ data: rows });
}

function getNetwork() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Network');
  if (!sheet) return jsonResponse({ data: [] });
  
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1).map(row => ({ name: row[0], phone: row[1] }));
  return jsonResponse({ data: rows });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
