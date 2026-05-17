/**
 * CSV Ingestion — combines CSVs from a Drive folder into the Master tab.
 */

/**
 * Main entry point from custom menu.
 */
function combineCSVs() {
  setStatus('Combining CSVs...', STATUS.COMBINING);
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

    var allRows = [];
    var allHeaders = {};

    csvFiles.forEach(function(file) {
      var content = file.blob.getDataAsString('UTF-8');
      var parsed = parseCSVContent(content);
      var headers = parsed[0];
      var rows = parsed.slice(1);

      // Union headers
      headers.forEach(function(h, i) {
        if (!allHeaders.hasOwnProperty(h)) {
          allHeaders[h] = Object.keys(allHeaders).length;
        }
      });

      // Normalize rows with source tracking
      rows.forEach(function(row) {
        var obj = {};
        headers.forEach(function(h, i) {
          obj[h] = (i < row.length) ? row[i] : '';
        });
        obj['_source_file'] = file.name;
        obj['_ingested_at'] = new Date().toISOString();
        allRows.push(obj);
      });
    });

    var headerList = Object.keys(allHeaders);
    headerList.push('_source_file', '_ingested_at', 'AI Review Status', 'AI Notes', 'Human Verified');

    // Write to Master tab
    var master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_MASTER);
    master.clear();

    // Header row
    master.getRange(1, 1, 1, headerList.length).setValues([headerList]);
    master.getRange(1, 1, 1, headerList.length).setFontWeight('bold');

    // Data rows
    var dataMatrix = allRows.map(function(rowObj) {
      return headerList.map(function(h) {
        return rowObj[h] !== undefined ? rowObj[h] : '';
      });
    });

    if (dataMatrix.length > 0) {
      master.getRange(2, 1, dataMatrix.length, headerList.length).setValues(dataMatrix);
    }

    // Move CSVs to archive
    var archiveFolderId = getSetting('ARCHIVE_CSV', 'B8');
    if (archiveFolderId) {
      moveToArchive(csvFiles, archiveFolderId);
    }

    master.autoResizeColumns(1, headerList.length);

    logEvent('combine_done', csvFiles.length + ' files, ' + dataMatrix.length + ' rows', '');

    // Update Verification column
    var lastRow = master.getLastRow();
    if (lastRow > 1) {
      var verifyCol = headerList.indexOf('Human Verified') + 1;
      var statusCol = headerList.indexOf('AI Review Status') + 1;
      if (verifyCol > 0) {
        master.getRange(2, verifyCol, lastRow - 1, 1).insertCheckboxes();
      }
      if (statusCol > 0) {
        master.getRange(2, statusCol, lastRow - 1, 1).setValue('pending');
      }
    }

    setStatus('Combined ' + csvFiles.length + ' CSVs — ' + dataMatrix.length + ' rows', STATUS.READY);
    showAlert('Combined ' + csvFiles.length + ' CSV files.\n\n' +
              'Master tab now has ' + dataMatrix.length + ' rows.\n' +
              'CSVs moved to archive folder.\n\n' +
              'Next: Run "2. Run AI Review" from the menu.');
  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
    logEvent('combine_error', e.message, '');
  }
}

/**
 * Lists CSV/ODS files in a Drive folder.
 */
function listCSVFiles(folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var result = [];

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName().toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.ods')) {
      result.push({ id: file.getId(), name: file.getName(), blob: file.getBlob() });
    }
  }
  return result;
}

/**
 * Parses CSV content into a 2D array.
 * Handles quoted fields and commas within quotes.
 */
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

/**
 * Moves uploaded CSV files to a dated subfolder in the archive.
 */
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

/**
 * Initializes the Master tab.
 */
function initMasterTab(sheet) {
  sheet.clear();
  sheet.getRange('A1').setValue('Run "1. Combine CSVs" from the menu to populate this tab.');
}

/**
 * Initializes the Review Log tab.
 */
function initReviewLogTab(sheet) {
  sheet.clear();
  var headers = ['Row #', 'Column', 'Issue', 'Confidence', 'AI Action', 'Timestamp'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange('A1:F1').setFontWeight('bold');
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 400);
  sheet.setColumnWidth(4, 80);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 160);
}

/**
 * Initializes the Workflow Log tab.
 */
function initWorkflowLogTab(sheet) {
  sheet.clear();
  var headers = ['Timestamp', 'Action', 'Details', 'Duration (s)'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange('A1:D1').setFontWeight('bold');
}

/**
 * Shows an alert dialog.
 */
function showAlert(message) {
  SpreadsheetApp.getUi().alert('The Social Space — Workflow', message, SpreadsheetApp.getUi().ButtonSet.OK);
}
