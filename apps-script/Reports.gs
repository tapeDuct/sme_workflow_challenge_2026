/**
 * Report Generation — creates per-partner Google Sheets and resets the template.
 */

/**
 * Main entry: generate per-partner reports and reset the template.
 */
function generateReports() {
  setStatus('Generating reports...', STATUS.GENERATING);
  logEvent('generate_start', 'Starting report generation');

  try {
    var reportsFolderId = getSetting('REPORTS_FOLDER', 'B9');
    var archiveCombinedFolderId = getSetting('ARCHIVE_COMBINED', 'B7');
    if (!reportsFolderId) {
      showAlert('Reports folder not configured. Set it in the Settings tab.');
      setStatus('Error: No reports folder', 'error');
      return;
    }

    var master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_MASTER);
    if (!master || master.getLastRow() < 2) {
      showAlert('Master tab is empty. Nothing to generate.');
      setStatus('No data to generate', STATUS.READY);
      return;
    }

    // Check for unverified rows
    var headers = master.getRange(1, 1, 1, master.getLastColumn()).getValues()[0];
    var verifyCol = headerIndex(headers, 'Human Verified') + 1;
    var statusCol = headerIndex(headers, 'AI Review Status') + 1;

    var unverified = 0;
    if (verifyCol > 0) {
      var verifyValues = master.getRange(2, verifyCol, master.getLastRow() - 1, 1).getValues();
      unverified = verifyValues.filter(function(v) { return v[0] !== true; }).length;
    }

    if (unverified > 0) {
      var ui = SpreadsheetApp.getUi();
      var response = ui.alert(
        'Unverified Rows',
        unverified + ' rows are not yet verified. Continue anyway?',
        ui.ButtonSet.YES_NO
      );
      if (response !== ui.Button.YES) {
        setStatus('Generation cancelled — ' + unverified + ' unverified rows', STATUS.READY);
        return;
      }
    }

    // Read full master data
    var data = master.getRange(2, 1, master.getLastRow() - 1, master.getLastColumn()).getValues();
    var headerList = headers;

    // Group by category
    var categoryCol = findCategoryColumn(headerList);
    if (categoryCol < 0) {
      showAlert('Could not find a category/partner column in the Master tab.');
      setStatus('Error: No category column found', 'error');
      return;
    }

    var groups = {};
    data.forEach(function(row) {
      var category = row[categoryCol] ? row[categoryCol].toString().trim() : '';
      if (!category || category === '' || category === 'null') return;
      if (!groups[category]) groups[category] = [];
      groups[category].push(row);
    });

    // Create dated subfolder
    var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var reportsParent = DriveApp.getFolderById(reportsFolderId);
    var subfolders = reportsParent.getFoldersByName('Reports_' + dateStr);
    var datedFolder = subfolders.hasNext() ? subfolders.next() : reportsParent.createFolder('Reports_' + dateStr);

    var count = 0;
    var reportUrls = [];

    Object.keys(groups).slice(0, 50).forEach(function(category) {
      var partnerRows = groups[category];

      // Create per-partner spreadsheet
      var ss = SpreadsheetApp.create('Report — ' + sanitizeSheetName(category));
      var sheet = ss.getSheets()[0];
      sheet.setName('Stock Movement');

      // Build report
      var reportHeaders = [
        'Location', 'SKU', 'Description', 'Quantity', 'Unit Price', 'Revenue', 'Partner', 'Source'
      ];
      var reportCols = [
        findColumn(headerList, ['Sales outlets', 'location', 'Location']),
        findColumn(headerList, ['sku', 'Item Number', 'SKU']),
        findColumn(headerList, ['item_description', 'Item description', 'Description']),
        findColumn(headerList, ['Sales volume', 'Current Inventory', 'quantity']),
        findColumn(headerList, ['Total selling price', 'unit_price', 'Unit Price']),
        findColumn(headerList, ['Revenue', 'revenue']),
        findColumn(headerList, ['Item supplier (Partner)', 'partner', 'item_category']),
        findColumn(headerList, ['_source_file', 'source', 'Source']),
      ];

      // Header row
      sheet.getRange(1, 1, 1, reportHeaders.length).setValues([reportHeaders]);
      sheet.getRange(1, 1, 1, reportHeaders.length).setFontWeight('bold');

      // Data rows
      var reportData = partnerRows.map(function(row) {
        return reportCols.map(function(colIdx) {
          if (colIdx >= 0 && colIdx < row.length) {
            var val = row[colIdx];
            return (val !== undefined && val !== null) ? val : '';
          }
          return '';
        });
      });

      if (reportData.length > 0) {
        sheet.getRange(2, 1, reportData.length, reportHeaders.length).setValues(reportData);
      }
      sheet.autoResizeColumns(1, reportHeaders.length);

      // Add summary rows
      var summaryRow = partnerRows.length + 3;
      sheet.getRange(summaryRow, 1).setValue('Total Rows:');
      sheet.getRange(summaryRow, 2).setValue(partnerRows.length);

      // Move to dated folder
      var file = DriveApp.getFileById(ss.getId());
      file.moveTo(datedFolder);

      reportUrls.push({ partner: category, url: ss.getUrl() });
      count++;
    });

    // Move master to archive (save a copy)
    if (archiveCombinedFolderId) {
      var templateSS = SpreadsheetApp.getActiveSpreadsheet();
      var archiveFolder = DriveApp.getFolderById(archiveCombinedFolderId);
      var archiveSub = archiveFolder.getFoldersByName('Combined_' + dateStr);
      var archiveDateFolder = archiveSub.hasNext() ? archiveSub.next() : archiveFolder.createFolder('Combined_' + dateStr);

      // Copy the current spreadsheet and move copy to archive
      var copyFile = DriveApp.getFileById(templateSS.getId()).makeCopy(
        'Master_Archived_' + dateStr + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmm')
      );
      copyFile.moveTo(archiveDateFolder);
    }

    // Reset template
    resetTemplateInternal();

    logEvent('generate_done', count + ' reports generated', '');

    var message = count + ' reports generated.\n\n';
    message += 'Reports folder: https://drive.google.com/drive/folders/' + datedFolder.getId() + '\n\n';
    message += 'The template has been reset for the next run.\n';
    message += 'Knowledge tab was preserved.\n\n';

    if (reportUrls.length <= 10) {
      reportUrls.forEach(function(r) {
        message += '• ' + r.partner + ': ' + r.url + '\n';
      });
    }

    setStatus(count + ' reports generated. Template reset.', STATUS.DONE);
    showAlert(message);

  } catch (e) {
    setStatus('Generation error: ' + e.message, 'error');
    logEvent('generate_error', e.message, '');
  }
}

/**
 * Resets the template — clears working tabs but keeps Knowledge and Settings.
 */
function resetTemplate() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    'Reset Template',
    'This will clear the Master tab, Review Log, and Workflow Log.\n\n' +
    'Settings and Knowledge tabs will be preserved.\n\n' +
    'Are you sure?',
    ui.ButtonSet.YES_NO
  );
  if (response === ui.YES) {
    resetTemplateInternal();
    showAlert('Template reset. Ready for next run.');
  }
}

/**
 * Internal reset — clears working tabs.
 */
function resetTemplateInternal() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var clearTabs = [TAB_MASTER, TAB_REVIEW_LOG, TAB_WORKFLOW_LOG];
  clearTabs.forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) {
      sheet.clear();
      if (name === TAB_MASTER)       initMasterTab(sheet);
      if (name === TAB_REVIEW_LOG)   initReviewLogTab(sheet);
      if (name === TAB_WORKFLOW_LOG) initWorkflowLogTab(sheet);
    }
  });

  PROPS.deleteProperty('REVIEW_PROGRESS');
  setStatus('Ready for next run', STATUS.READY);
}

/**
 * Finds the category/partner column index in the header array.
 */
function findCategoryColumn(headers) {
  var candidates = ['item_category', 'Item category', 'partner', 'Item supplier (Partner)'];
  for (var i = 0; i < candidates.length; i++) {
    var idx = headerIndex(headers, candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}
