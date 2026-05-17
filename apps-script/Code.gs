/**
 * Dashboard / entry point. Sets up custom menu on spreadsheet open.
 */

var TAB_SETTINGS    = 'Settings';
var TAB_KNOWLEDGE   = 'Knowledge';
var TAB_MASTER      = 'Master';
var TAB_REVIEW_LOG  = 'Review Log';
var TAB_WORKFLOW_LOG = 'Workflow Log';
var TAB_DASHBOARD   = 'Dashboard';

var PROPS = PropertiesService.getUserProperties();

var STATUS = {
  READY:        'ready',
  COMBINING:    'combining',
  REVIEWING:    'reviewing',
  AWAITING_FIX: 'awaiting_human',
  GENERATING:   'generating',
  DONE:         'done',
};

/**
 * Runs on spreadsheet open — creates custom menu.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('The Social Space ▾')
    .addItem('1. Combine CSVs', 'combineCSVs')
    .addSeparator()
    .addItem('2. Run AI Review', 'runAIReview')
    .addItem('3. Re-Run AI Review (unverified only)', 'rerunAIReview')
    .addSeparator()
    .addItem('4. Confirm & Generate Reports', 'generateReports')
    .addSeparator()
    .addSubMenu(ui.createMenu('Settings ▸')
      .addItem('Save API Key', 'saveApiKey')
      .addItem('Reload Knowledge Tab', 'reloadKnowledgeTab')
      .addItem('Reset Template', 'resetTemplate'))
    .addToUi();

  ensureTabsExist();
}

/**
 * Creates all required tabs if they don't exist.
 */
function ensureTabsExist() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = [TAB_DASHBOARD, TAB_SETTINGS, TAB_KNOWLEDGE, TAB_MASTER,
              TAB_REVIEW_LOG, TAB_WORKFLOW_LOG];

  tabs.forEach(function(name) {
    if (!ss.getSheetByName(name)) {
      var sheet = ss.insertSheet(name);
      if (name === TAB_SETTINGS)     initSettingsTab(sheet);
      if (name === TAB_KNOWLEDGE)    initKnowledgeTab(sheet);
      if (name === TAB_MASTER)       initMasterTab(sheet);
      if (name === TAB_REVIEW_LOG)   initReviewLogTab(sheet);
      if (name === TAB_WORKFLOW_LOG) initWorkflowLogTab(sheet);
      if (name === TAB_DASHBOARD)    initDashboardTab(sheet);
    }
  });
}

/**
 * Writes a status message to the Dashboard tab.
 */
function setStatus(message, statusType) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_DASHBOARD);
  if (!sheet) return;
  sheet.getRange('B2').setValue(message);
  if (statusType) {
    sheet.getRange('B3').setValue(statusType);
  }
  SpreadsheetApp.flush();
}

/**
 * Logs a workflow event to the Workflow Log tab.
 */
function logEvent(action, details, duration) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_WORKFLOW_LOG);
  if (!sheet) return;
  sheet.appendRow([new Date(), action, details, duration || '']);
}

/**
 * Initializes the Dashboard tab.
 */
function initDashboardTab(sheet) {
  sheet.clear();
  var headers = [
    ['The Social Space — Workflow Dashboard', '', ''],
    ['Status:', 'Ready', ''],
    ['Phase:', STATUS.READY, ''],
    ['', '', ''],
    ['Instructions:', '', ''],
    ['1. Use the "The Social Space ▼" menu at the top', '', ''],
    ['2. Drop CSV files into the "Add CSV for Processing" Drive folder', '', ''],
    ['3. Run Combine → Review → Generate', '', ''],
    ['', '', ''],
    ['Settings tab → Configure AI model, API key, and folders', '', ''],
    ['Knowledge tab → Common corrections (auto-learns)', '', ''],
  ];
  sheet.getRange(1, 1, headers.length, 3).setValues(headers);
  sheet.getRange('B2:B3').setFontWeight('bold');
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 400);
}
