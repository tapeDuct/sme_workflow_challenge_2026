/**
 * Knowledge Tab — auto-learns corrections from user actions.
 */

/**
 * Initializes the Knowledge tab with headers.
 */
function initKnowledgeTab(sheet) {
  sheet.clear();
  var headers = ['Column', 'Original Value', 'Corrected Value', 'Source', 'Times Applied'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange('A1:E1').setFontWeight('bold');
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 250);
  sheet.setColumnWidth(3, 250);
  sheet.setColumnWidth(4, 250);
  sheet.setColumnWidth(5, 100);

  // Seed with known corrections from the data
  var seeds = [
    ['Sales outlets', 'The Social Space (Kreta Ayer)', 'Kreta Ayer', 'Seed data', 0],
    ['Sales outlets', 'The Social Space (Potong Pasir)', 'Potong Pasir', 'Seed data', 0],
    ['Item supplier (Partner)', 'Riau Candle', 'Riau Candles', 'Seed data', 0],
  ];
  if (seeds.length > 0) {
    sheet.getRange(2, 1, seeds.length, 5).setValues(seeds);
  }
}

/**
 * Check if any known fixes apply to a row.
 * Returns array of {column, original, corrected, issue}.
 */
function checkKnowledgeForRow(rowObj, headers) {
  var knowledge = loadKnowledgeTab();
  var fixes = [];

  headers.forEach(function(header) {
    var value = rowObj[header] ? rowObj[header].toString().trim() : '';
    if (!value || value === '') return;

    if (knowledge[header]) {
      var corrected = knowledge[header][value];
      if (corrected && corrected !== value) {
        fixes.push({
          column: header,
          original: value,
          corrected: corrected,
          issue: 'Known correction: "' + value + '" → "' + corrected + '"',
        });
        // Increment counter
        incrementKnowledgeCount(header, value, corrected);
      }
    }
  });

  return fixes;
}

/**
 * Loads the Knowledge tab into a lookup structure.
 */
function loadKnowledgeTab() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_KNOWLEDGE);
  if (!sheet || sheet.getLastRow() < 2) return {};

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  var knowledge = {};

  data.forEach(function(row) {
    var col = row[0].toString().trim();
    var original = row[1].toString().trim();
    var corrected = row[2].toString().trim();
    if (col && original && corrected && original !== corrected) {
      if (!knowledge[col]) knowledge[col] = {};
      knowledge[col][original] = corrected;
    }
  });

  return knowledge;
}

/**
 * Increments the "Times Applied" counter for a known correction.
 */
function incrementKnowledgeCount(column, original, corrected) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_KNOWLEDGE);
  if (!sheet || sheet.getLastRow() < 2) return;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString().trim() === column &&
        data[i][1].toString().trim() === original &&
        data[i][2].toString().trim() === corrected) {
      var currentCount = sheet.getRange(i + 2, 5).getValue() || 0;
      sheet.getRange(i + 2, 5).setValue(parseInt(currentCount) + 1);
      return;
    }
  }
}

/**
 * Learns from user edits on the Master tab.
 * Called by onEdit trigger — detects if a cell was changed from its original value.
 */
function onEditTrigger(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  if (sheet.getName() !== TAB_MASTER) return;

  var row = e.range.getRow();
  var col = e.range.getColumn();

  // Skip header row and verification column
  if (row < 2) return;

  // Only process after AI review has run
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerName = headers[col - 1];
  if (!headerName) return;

  var skipCols = ['_source_file', '_ingested_at', 'AI Review Status', 'AI Notes', 'Human Verified'];
  if (skipCols.indexOf(headerName) >= 0) return;

  var newValue = e.range.getValue() ? e.range.getValue().toString().trim() : '';
  if (!newValue) return;

  // Get old value from Properties (stored during review)
  var oldKey = 'CELL_' + row + '_' + col;
  var oldValue = PROPS.getProperty(oldKey);

  if (oldValue && oldValue.trim() !== newValue) {
    addToKnowledge(headerName, oldValue.trim(), newValue);
  }

  PROPS.setProperty(oldKey, newValue);
}

/**
 * Adds a new correction to the Knowledge tab.
 */
function addToKnowledge(column, original, corrected) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_KNOWLEDGE);
  if (!sheet) return;

  // Check if already exists
  var data = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 3).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString().trim() === column &&
        data[i][1].toString().trim() === original &&
        data[i][2].toString().trim() === corrected) {
      return; // Already exists, count will increment on next usage
    }
  }

  sheet.appendRow([column, original, corrected, 'User-' + new Date().toISOString().split('T')[0], 1]);
}

/**
 * Reloads and re-initializes the Knowledge tab (keeps user data).
 */
function reloadKnowledgeTab() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_KNOWLEDGE);
  if (!sheet) return;

  // Backup existing data
  var existing = [];
  if (sheet.getLastRow() >= 2) {
    existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  }

  initKnowledgeTab(sheet);

  // Restore user entries (skip seed duplicates)
  var seedCols = {};
  var seedData = sheet.getRange(2, 1, Math.min(sheet.getLastRow() - 1, 3), 3).getValues();
  seedData.forEach(function(r) { seedCols[r[0] + '|' + r[1]] = true; });

  existing.forEach(function(row) {
    if (!seedCols[row[0] + '|' + row[1]]) {
      sheet.appendRow(row);
    }
  });

  sheet.autoResizeColumns(1, 5);
  showAlert('Knowledge tab reloaded. Common corrections are active.');
}
