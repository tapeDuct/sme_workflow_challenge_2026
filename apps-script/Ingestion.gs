/**
 * CSV Ingestion — combines CSVs from a Drive folder into the Master tab.
 *
 * Features:
 *   - Fuzzy column matching to canonical master column names
 *   - Value normalization (locations, partners, Knowledge tab fixes)
 *   - Pre-check validation before combine
 *   - Empty key cell highlighting
 */

// Canonical column names from the product mix report template
var CANONICAL_COLUMNS = [
  'Sales outlets', 'Item description', 'Item Number', 'Specifications',
  'Company', 'Item category', 'Current Inventory', 'Sales volume',
  'Sale percentage', 'Total selling price', 'Revenue',
  'Actual amount received comparison', 'Profit', 'Gross profit',
  'Item brand', 'Item supplier (Partner)', '口味金额',
];

// Alias mappings: common variations → canonical column name
var COLUMN_ALIASES = {
  'location':               'Sales outlets',
  'outlet':                 'Sales outlets',
  'store':                  'Sales outlets',
  'sales outlet':           'Sales outlets',
  'sales location':         'Sales outlets',
  'product name':           'Item description',
  'description':            'Item description',
  'item name':              'Item description',
  'name':                   'Item description',
  'sku':                    'Item Number',
  'item #':                 'Item Number',
  'item no':                'Item Number',
  'item code':              'Item Number',
  'product code':           'Item Number',
  'barcode':                'Item Number',
  'spec':                   'Specifications',
  'specs':                  'Specifications',
  'category':               'Item category',
  'partner category':       'Item category',
  'inventory':              'Current Inventory',
  'stock':                  'Current Inventory',
  'qty on hand':            'Current Inventory',
  'stock on hand':          'Current Inventory',
  'closing stock':          'Current Inventory',
  'sales':                  'Sales volume',
  'sales qty':              'Sales volume',
  'units sold':             'Sales volume',
  'qty sold':               'Sales volume',
  'price':                  'Total selling price',
  'selling price':          'Total selling price',
  'retail price':           'Total selling price',
  'unit price':             'Total selling price',
  'rev':                    'Revenue',
  'sales revenue':          'Revenue',
  'partner':                'Item supplier (Partner)',
  'supplier':               'Item supplier (Partner)',
  'vendor':                 'Item supplier (Partner)',
  'brand':                  'Item brand',
  'profit':                 'Profit',
  'gross profit':           'Gross profit',
  'sale pct':               'Sale percentage',
  'sale %':                 'Sale percentage',
};

// Key columns that trigger highlighting when empty
var KEY_COLUMNS = [
  'Sales outlets', 'Item description', 'Item Number',
  'Item category', 'Sales volume', 'Revenue',
];

/**
 * Main entry point from custom menu.
 */
function combineCSVs() {
  setStatus('Combining CSVs...', STATUS.COMBINING);
  var startTime = new Date().getTime();
  logEvent('combine_start', 'Starting CSV combination');

  try {
    var dropFolderId = getSetting('DROP_FOLDER', 'B6');
    if (!dropFolderId) {
      showAlert('Settings not configured. Please set the Drop CSV Folder ID in the Settings tab.');
      setStatus('Error: No drop folder configured', 'error');
      return;
    }

    var csvFiles = listCSVFiles(dropFolderId);
    if (csvFiles.length === 0) {
      showAlert('No CSV files found in the "Add CSV for Processing" folder.');
      setStatus('No CSV files found', STATUS.READY);
      return;
    }

    // Parse all files into raw arrays
    var parsedFiles = [];
    csvFiles.forEach(function(file) {
      var content;
      var mime = file.blob.getContentType();
      if (mime.indexOf('spreadsheet') >= 0 || file.name.toLowerCase().endsWith('.ods') || file.name.toLowerCase().endsWith('.xlsx')) {
        content = file.blob.getAs('text/csv').getDataAsString('UTF-8');
      } else {
        content = file.blob.getDataAsString('UTF-8');
      }
      var parsed = parseCSVContent(content);
      if (parsed.length > 0) {
        parsedFiles.push({ file: file, headers: parsed[0], rows: parsed.slice(1) });
      }
    });

    if (parsedFiles.length === 0) {
      showAlert('No readable data found in CSV files.');
      setStatus('No readable data', STATUS.READY);
      return;
    }

    // --- Pre-check ---
    var preCheckWarnings = preCheckCSVs(parsedFiles);
    if (preCheckWarnings.length > 0) {
      var ui = SpreadsheetApp.getUi();
      var msg = 'CSV Pre-Check found issues:\n\n' + preCheckWarnings.slice(0, 8).join('\n');
      if (preCheckWarnings.length > 8) msg += '\n... and ' + (preCheckWarnings.length - 8) + ' more';
      msg += '\n\nContinue anyway?';
      var resp = ui.alert('Pre-Check Warning', msg, ui.ButtonSet.YES_NO);
      if (resp !== ui.Button.YES) {
        setStatus('Cancelled by user after pre-check', STATUS.READY);
        return;
      }
    }

    // --- Column mapping ---
    var columnMap = {};      // canonical → index
    var unmapped = {};
    var mappedCount = 0;

    parsedFiles.forEach(function(pf) {
      pf.headerMap = {};     // source col index → canonical col index
      pf.headers.forEach(function(srcCol, i) {
        var canonical = matchColumn(srcCol);
        if (canonical) {
          if (!columnMap.hasOwnProperty(canonical)) {
            columnMap[canonical] = Object.keys(columnMap).length;
          }
          pf.headerMap[i] = columnMap[canonical];
          mappedCount++;
        } else {
          var unmappedName = '[unmapped] ' + sanitizeSheetName(srcCol);
          if (!columnMap.hasOwnProperty(unmappedName)) {
            columnMap[unmappedName] = Object.keys(columnMap).length;
          }
          pf.headerMap[i] = columnMap[unmappedName];
          if (!unmapped.hasOwnProperty(unmappedName)) {
            unmapped[unmappedName] = srcCol;
          }
        }
      });
    });

    // Build canonical header list (sorted by insert order)
    var canonicalList = Object.keys(columnMap).sort(function(a, b) { return columnMap[a] - columnMap[b]; });
    var systemCols = ['_source_file', '_ingested_at', 'AI Review Status', 'AI Notes', 'Human Verified'];
    var fullHeaderList = canonicalList.concat(systemCols);

    // --- Combine rows ---
    var allRows = [];
    parsedFiles.forEach(function(pf) {
      pf.rows.forEach(function(row) {
        var obj = {};
        // Map source columns to canonical positions
        pf.headers.forEach(function(srcCol, i) {
          var canonIdx = pf.headerMap[i];
          var canonName = canonicalList[canonIdx];
          obj[canonName] = (i < row.length) ? row[i] : '';
        });
        obj['_source_file'] = pf.file.name;
        obj['_ingested_at'] = new Date().toISOString();
        allRows.push(obj);
      });
    });

    // --- Value normalization ---
    var normCount = normalizeValues(allRows, canonicalList, fullHeaderList);

    // --- Write to Master tab ---
    var master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_MASTER);
    master.clear();

    master.getRange(1, 1, 1, fullHeaderList.length).setValues([fullHeaderList]);
    master.getRange(1, 1, 1, fullHeaderList.length).setFontWeight('bold');

    var dataMatrix = allRows.map(function(rowObj) {
      return fullHeaderList.map(function(h) {
        return rowObj[h] !== undefined ? rowObj[h] : '';
      });
    });

    if (dataMatrix.length > 0) {
      master.getRange(2, 1, dataMatrix.length, fullHeaderList.length).setValues(dataMatrix);
    }

    // Set initial status
    var statusIdx = fullHeaderList.indexOf('AI Review Status');
    if (statusIdx >= 0) {
      master.getRange(2, statusIdx + 1, master.getLastRow() - 1, 1).setValue('Pending');
    }

    // --- Highlight empty key cells ---
    var highlightCount = highlightEmptyKeyCells(master, fullHeaderList, allRows.length);

    // --- Move CSVs to archive ---
    var archiveFolderId = getSetting('ARCHIVE_CSV', 'B8');
    if (archiveFolderId) {
      moveToArchive(csvFiles, archiveFolderId);
    }

    master.autoResizeColumns(1, fullHeaderList.length);

    var elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);

    // Build summary
    var summaryMsg = 'Combined ' + csvFiles.length + ' CSV files.\n\n';
    summaryMsg += 'Rows: ' + dataMatrix.length + '\n';
    summaryMsg += 'Canonical columns: ' + canonicalList.length + '\n';
    if (normCount > 0) summaryMsg += 'Values normalized: ' + normCount + '\n';
    if (highlightCount > 0) summaryMsg += 'Empty cells highlighted: ' + highlightCount + '\n';

    var unmappedList = Object.keys(unmapped);
    if (unmappedList.length > 0) {
      summaryMsg += '\nUnmapped columns (added with [unmapped] prefix):\n';
      unmappedList.forEach(function(u) {
        summaryMsg += '  ' + u + ' ← ' + unmapped[u] + '\n';
      });
    }

    summaryMsg += '\nNext: Run "2. Run AI Review" from the menu.';

    logEvent('combine_done', csvFiles.length + ' files, ' + dataMatrix.length + ' rows (' + elapsed + 's)', elapsed);
    setStatus('Combined ' + csvFiles.length + ' CSVs — ' + dataMatrix.length + ' rows', STATUS.READY);
    showAlert(summaryMsg);

  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
    logEvent('combine_error', e.message, '');
  }
}

// =========================================================================
// Column matching
// =========================================================================

/**
 * Match a source column name to a canonical column name.
 * Returns the canonical name or null if no match.
 */
function matchColumn(sourceName) {
  var s = sourceName.toString().trim();

  // 1. Exact match
  if (CANONICAL_COLUMNS.indexOf(s) >= 0) return s;

  // 2. Case-insensitive match
  var sLower = s.toLowerCase();
  for (var i = 0; i < CANONICAL_COLUMNS.length; i++) {
    if (CANONICAL_COLUMNS[i].toLowerCase() === sLower) return CANONICAL_COLUMNS[i];
  }

  // 3. Alias lookup
  if (COLUMN_ALIASES.hasOwnProperty(sLower)) return COLUMN_ALIASES[sLower];

  // 4. Normalized match (strip underscores, spaces, parens)
  var norm = sLower.replace(/[_()\s]+/g, '');
  for (var j = 0; j < CANONICAL_COLUMNS.length; j++) {
    var cNorm = CANONICAL_COLUMNS[j].toLowerCase().replace(/[_()\s]+/g, '');
    if (cNorm === norm) return CANONICAL_COLUMNS[j];
    // Substring match (source contains canonical or vice versa)
    if (cNorm.length > 4 && norm.length > 4 && (cNorm.indexOf(norm) >= 0 || norm.indexOf(cNorm) >= 0)) {
      return CANONICAL_COLUMNS[j];
    }
  }

  return null;
}

// =========================================================================
// Pre-check
// =========================================================================

/**
 * Validate CSVs before combining. Returns an array of warning strings.
 */
function preCheckCSVs(parsedFiles) {
  var warnings = [];

  parsedFiles.forEach(function(pf) {
    var fileName = pf.file.name;
    var rows = pf.rows;
    var headers = pf.headers;
    var hLower = headers.map(function(h) { return h.toString().toLowerCase(); });

    // Required column check
    var required = ['Item Number', 'Item description', 'Sales outlets', 'Item category'];
    required.forEach(function(req) {
      var found = false;
      for (var k = 0; k < headers.length; k++) {
        if (matchColumn(headers[k]) === req) { found = true; break; }
      }
      if (!found) {
        warnings.push('WARNING: ' + fileName + ' — missing column "' + req + '"');
      }
    });

    // Empty key field check
    var keyCandidates = {
      'Item Number': null,
      'Item description': null,
      'Sales outlets': null,
      'Item category': null,
    };

    headers.forEach(function(h, i) {
      var canon = matchColumn(h);
      if (canon && keyCandidates.hasOwnProperty(canon)) {
        keyCandidates[canon] = i;
      }
    });

    Object.keys(keyCandidates).forEach(function(key) {
      var colIdx = keyCandidates[key];
      if (colIdx === null) return;
      var emptyCount = 0;
      rows.forEach(function(row) {
        var val = row[colIdx] ? row[colIdx].toString().trim() : '';
        if (!val || val === '-' || val === '') emptyCount++;
      });
      var pct = Math.round(emptyCount / rows.length * 100);
      if (pct > 30) {
        warnings.push('WARNING: ' + fileName + ' — ' + pct + '% of "' + key + '" is empty');
      }
    });

    // Data type check on numeric columns
    var numericChecks = ['Sales volume', 'Revenue', 'Total selling price', 'Current Inventory'];
    numericChecks.forEach(function(numCol) {
      var foundIdx = null;
      headers.forEach(function(h, i) {
        if (matchColumn(h) === numCol) foundIdx = i;
      });
      if (foundIdx === null) return;

      var textCount = 0;
      rows.slice(0, 30).forEach(function(row) {
        var val = row[foundIdx] ? row[foundIdx].toString().trim() : '';
        if (val && val !== '-' && isNaN(parseFloat(val))) textCount++;
      });
      if (textCount > 0) {
        warnings.push('WARNING: ' + fileName + ' — "' + numCol + '" has ' + textCount + ' non-numeric values');
      }
    });
  });

  return warnings;
}

// =========================================================================
// Value normalization (moved from Review.gs heuristics)
// =========================================================================

/**
 * Normalize values in-place: locations, partner names, Knowledge tab fixes.
 * Returns number of values fixed.
 */
function normalizeValues(allRows, canonicalList, fullHeaderList) {
  var count = 0;

  // Find column indices
  var locIdx = canonicalList.indexOf('Sales outlets');
  var partnerIdx = canonicalList.indexOf('Item supplier (Partner)');
  var catIdx = canonicalList.indexOf('Item category');

  var locMap = {
    'The Social Space (Kreta Ayer)': 'Kreta Ayer',
    'The Social Space (Potong Pasir)': 'Potong Pasir',
    'KRETA AYER': 'Kreta Ayer',
    'POTONG PASIR': 'Potong Pasir',
    'ONLINE STORE': 'Online',
    'Online Store': 'Online',
  };

  // Load Knowledge tab
  var knowledge = loadKnowledgeTab();

  allRows.forEach(function(rowObj) {
    // Standardize locations
    if (locIdx >= 0 && rowObj[canonicalList[locIdx]]) {
      var locVal = rowObj[canonicalList[locIdx]].toString().trim();
      if (locMap[locVal]) {
        rowObj[canonicalList[locIdx]] = locMap[locVal];
        count++;
      }
    }

    // Apply Knowledge tab fixes to all columns
    canonicalList.forEach(function(canonCol) {
      var val = rowObj[canonCol] ? rowObj[canonCol].toString().trim() : '';
      if (!val || !knowledge[canonCol]) return;
      var corrected = knowledge[canonCol][val];
      if (corrected && corrected !== val) {
        rowObj[canonCol] = corrected;
        count++;
        incrementKnowledgeCount(canonCol, val, corrected);
      }
    });
  });

  return count;
}

// =========================================================================
// Empty cell highlighting
// =========================================================================

/**
 * Highlight empty cells in key columns with yellow background.
 * Returns number of cells highlighted.
 */
function highlightEmptyKeyCells(master, fullHeaderList, rowCount) {
  var count = 0;

  KEY_COLUMNS.forEach(function(keyCol) {
    var colIdx = fullHeaderList.indexOf(keyCol);
    if (colIdx < 0) return; // Column not in this dataset

    for (var r = 2; r <= rowCount + 1; r++) {
      var cell = master.getRange(r, colIdx + 1);
      var val = cell.getValue();
      var strVal = val ? val.toString().trim() : '';

      if (!strVal || strVal === '-' || strVal === 'Item without S/No.') {
        cell.setBackground('#fef08a'); // yellow
        cell.setNote('Missing — requires manual entry');
        count++;
      }
    }
  });

  return count;
}

// =========================================================================
// CSV file listing and parsing
// =========================================================================

function listCSVFiles(folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var result = [];
  var supported = [
    'text/csv',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName().toLowerCase();
    var mime = file.getMimeType();

    if (supported.indexOf(mime) >= 0 || name.endsWith('.csv') || name.endsWith('.ods') || name.endsWith('.xlsx')) {
      result.push({ id: file.getId(), name: file.getName(), blob: file.getBlob() });
    }
  }
  return result;
}

function parseCSVContent(content) {
  var rows = [];
  var lines = content.split(/\r?\n/);
  lines.forEach(function(line) {
    if (line.trim() === '') return;
    var cells = [];
    var inQuotes = false;
    var current = '';
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"' && !inQuotes) {
        inQuotes = true;
      } else if (ch === '"' && inQuotes) {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    if (cells.length > 1 || cells[0] !== '') {
      rows.push(cells);
    }
  });
  return rows;
}

function moveToArchive(csvFiles, archiveFolderId) {
  var parentFolder = DriveApp.getFolderById(archiveFolderId);
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var subfolders = parentFolder.getFoldersByName(dateStr);
  var subfolder = subfolders.hasNext() ? subfolders.next() : parentFolder.createFolder(dateStr);

  csvFiles.forEach(function(file) {
    var driveFile = DriveApp.getFileById(file.id);
    driveFile.moveTo(subfolder);
  });
}

// =========================================================================
// Tab initialization
// =========================================================================

function initMasterTab(sheet) {
  sheet.clear();
  sheet.getRange('A1').setValue('Run "1. Combine CSVs" from the menu to populate this tab.');
}

function initReviewLogTab(sheet) {
  sheet.clear();
  var headers = ['Row #', 'Column', 'Issue', 'Confidence', 'AI Action', 'Link', 'Timestamp'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange('A1:G1').setFontWeight('bold');
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 400);
  sheet.setColumnWidth(4, 80);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 200);
  sheet.setColumnWidth(7, 160);
}

function initWorkflowLogTab(sheet) {
  sheet.clear();
  var headers = ['Timestamp', 'Action', 'Details', 'Duration (s)'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange('A1:D1').setFontWeight('bold');
}

function showAlert(message) {
  SpreadsheetApp.getUi().alert('The Social Space — Workflow', message, SpreadsheetApp.getUi().ButtonSet.OK);
}
