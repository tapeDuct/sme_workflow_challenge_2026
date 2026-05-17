/**
 * Report Generation — 7-section per-partner reports per the challenge requirements.
 *
 * Sections:
 *   1. Opening Stock Balance
 *   2. Sales
 *   3. Goods Received (GRN)
 *   4. Inventory Adjustment
 *   5. Location Transfer
 *   6. Closing Stock Balance
 *   7. Revenue Due to Vendor
 */

// Section colors (background)
var COLOR_BLUE    = '#dbeafe';
var COLOR_GREEN   = '#dcfce7';
var COLOR_ORANGE  = '#fef3c7';
var COLOR_PURPLE  = '#f3e8ff';
var COLOR_TEAL    = '#ccfbf1';
var COLOR_RED     = '#fee2e2';
var COLOR_DGREEN  = '#d1fae5';
var COLOR_GRAY    = '#f3f4f6';

/**
 * Main entry: generate per-partner reports and reset the template.
 */
function generateReports() {
  setStatus('Generating reports...', STATUS.GENERATING);
  var startTime = new Date().getTime();
  logEvent('generate_start', 'Starting 7-section report generation');

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

    var data = master.getRange(2, 1, master.getLastRow() - 1, master.getLastColumn()).getValues();

    var categoryCol = findCategoryColumn(headers);
    if (categoryCol < 0) {
      showAlert('Could not find a category/partner column.');
      setStatus('Error: No category column found', 'error');
      return;
    }

    // Group rows by partner
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
    var partners = Object.keys(groups).sort();

    // Limit to first 50 partners for performance
    partners.slice(0, 50).forEach(function(category, index) {
      setStatus('Generating report ' + (index + 1) + ' of ' + Math.min(partners.length, 50) + ': ' + category, STATUS.GENERATING);

      var partnerRows = groups[category];
      var ss = SpreadsheetApp.create('Report — ' + sanitizeSheetName(category));
      var sheet = ss.getSheets()[0];
      sheet.setName('Stock Movement');

      buildPartnerReport(sheet, category, partnerRows, headers, dateStr);

      var file = DriveApp.getFileById(ss.getId());
      file.moveTo(datedFolder);

      reportUrls.push({ partner: category, url: ss.getUrl() });
      count++;
    });

    // Archive master copy
    if (archiveCombinedFolderId) {
      var templateSS = SpreadsheetApp.getActiveSpreadsheet();
      var archiveFolder = DriveApp.getFolderById(archiveCombinedFolderId);
      var archiveSub = archiveFolder.getFoldersByName('Combined_' + dateStr);
      var archiveDateFolder = archiveSub.hasNext() ? archiveSub.next() : archiveFolder.createFolder('Combined_' + dateStr);
      var copyFile = DriveApp.getFileById(templateSS.getId()).makeCopy(
        'Master_Archived_' + dateStr + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmm')
      );
      copyFile.moveTo(archiveDateFolder);
    }

    resetTemplateInternal();

    var elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);
    logEvent('generate_done', count + ' reports (' + elapsed + 's)', elapsed);

    var message = count + ' reports generated in ' + elapsed + 's.\n\n';
    message += 'Reports folder: https://drive.google.com/drive/folders/' + datedFolder.getId() + '\n\n';

    if (reportUrls.length <= 10) {
      reportUrls.forEach(function(r) { message += '  ' + r.partner + ': ' + r.url + '\n'; });
    }

    setStatus(count + ' reports generated. Template reset.', STATUS.DONE);
    showAlert(message);

  } catch (e) {
    setStatus('Generation error: ' + e.message, 'error');
    logEvent('generate_error', e.message, '');
  }
}

// =========================================================================
// Report builder — orchestrates all 7 sections
// =========================================================================

/**
 * Builds a complete 7-section partner report on the given sheet.
 */
function buildPartnerReport(sheet, partnerName, rows, allHeaders, dateStr) {
  var colIdx = buildColumnIndex(allHeaders);
  var currentRow = 1;

  // --- BANNER ---
  sheet.getRange(currentRow, 1, 1, 7).merge();
  sheet.getRange(currentRow++, 1).setValue('CONSIGNMENT REPORT — ' + partnerName)
    .setFontSize(14).setFontWeight('bold').setFontColor('#1e40af');
  sheet.getRange(currentRow, 1, 1, 7).merge();
  sheet.getRange(currentRow++, 1).setValue('Period: ' + dateStr + '  |  Locations: Kreta Ayer, Potong Pasir, Online')
    .setFontSize(10).setFontColor('#6b7280');
  currentRow++;

  // --- SECTIONS ---
  currentRow = buildOpeningStock(sheet, currentRow, rows, colIdx);
  currentRow++;
  currentRow = buildSales(sheet, currentRow, rows, colIdx);
  currentRow++;
  currentRow = buildGRN(sheet, currentRow, rows, colIdx);
  currentRow++;
  currentRow = buildAdjustments(sheet, currentRow, rows, colIdx);
  currentRow++;
  currentRow = buildTransfers(sheet, currentRow, rows, colIdx);
  currentRow++;
  currentRow = buildClosingStock(sheet, currentRow, rows, colIdx);
  currentRow++;
  currentRow = buildRevenue(sheet, currentRow, rows, colIdx);

  // --- SUMMARY ---
  currentRow += 2;
  buildReportSummary(sheet, currentRow, partnerName, rows, colIdx);

  sheet.autoResizeColumns(1, 8);
}

// =========================================================================
// Column index lookup
// =========================================================================

function buildColumnIndex(headers) {
  return {
    location:     findColumn(headers, ['Sales outlets', 'location', 'Location']),
    sku:          findColumn(headers, ['Item Number', 'sku', 'SKU']),
    description:  findColumn(headers, ['Item description', 'item_description', 'Description']),
    spec:         findColumn(headers, ['Specifications', 'specifications']),
    category:     findColumn(headers, ['Item category', 'item_category', 'category']),
    inventory:    findColumn(headers, ['Current Inventory', 'current_inventory', 'quantity', 'Stock']),
    salesVol:     findColumn(headers, ['Sales volume', 'sales_volume', 'Sales Volume']),
    price:        findColumn(headers, ['Total selling price', 'unit_price', 'Total selling price']),
    revenue:      findColumn(headers, ['Revenue', 'revenue']),
    profit:       findColumn(headers, ['Profit', 'profit']),
    received:     findColumn(headers, ['Actual amount received comparison', 'received']),
    source:       findColumn(headers, ['_source_file', 'source', 'Source']),
  };
}

function rowVal(row, colIdx) {
  if (colIdx < 0 || colIdx >= row.length) return '';
  var v = row[colIdx];
  return (v !== undefined && v !== null) ? v : '';
}

function rowNum(row, colIdx) {
  var v = rowVal(row, colIdx);
  if (v === '' || v === '-') return 0;
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// =========================================================================
// Section 1: Opening Stock Balance
// =========================================================================

function buildOpeningStock(sheet, startRow, rows, colIdx) {
  var r = startRow;
  writeSectionHeader(sheet, r++, 1, 8, '1. OPENING STOCK BALANCE', 'Units on hand at start of period, by location', COLOR_BLUE);

  var colHeaders = ['Location', 'SKU', 'Description', 'Opening Qty', 'Unit Price', 'Est. Valuation', 'Source'];
  writeHeaders(sheet, r++, colHeaders, '#93c5fd');

  var hasData = false;
  var totalVal = 0;

  rows.forEach(function(row) {
    var loc = standardizeLocation(rowVal(row, colIdx.location));
    var inv = rowNum(row, colIdx.inventory);
    var sales = rowNum(row, colIdx.salesVol);
    var price = rowNum(row, colIdx.price);
    var estimated = inv + sales;
    if (estimated < 0) estimated = 0;
    var valuation = estimated * price;

    var rowData = [
      loc,
      rowVal(row, colIdx.sku),
      rowVal(row, colIdx.description),
      estimated,
      price > 0 ? price : '',
      valuation > 0 ? valuation : '',
      'Estimated: closing + sales',
    ];
    sheet.getRange(r, 1, 1, rowData.length).setValues([rowData]);
    totalVal += valuation;
    hasData = true;
    r++;
  });

  if (!hasData) writePlaceholder(sheet, r++, 'No data available — requires POS/GRN transaction records', colHeaders.length);
  else {
    sheet.getRange(r, 1, 1, 7).merge();
    sheet.getRange(r++, 1).setValue('Note: Opening stock estimated from Current Inventory + Sales. Update when POS data is available.')
      .setFontStyle('italic').setFontSize(9).setFontColor('#6b7280');
  }

  // Highlight per-location subtotals
  sheet.getRange(r++, 1).setValue('');
  return r;
}

// =========================================================================
// Section 2: Sales
// =========================================================================

function buildSales(sheet, startRow, rows, colIdx) {
  var r = startRow;
  writeSectionHeader(sheet, r++, 1, 8, '2. SALES', 'Units sold through each channel', COLOR_GREEN);

  var colHeaders = ['Location', 'SKU', 'Description', 'Units Sold', 'Unit Price', 'Revenue', 'Profit'];
  writeHeaders(sheet, r++, colHeaders, '#86efac');

  var totalRevenue = 0;
  var totalUnits = 0;
  var hasData = false;

  rows.forEach(function(row) {
    var sales = rowNum(row, colIdx.salesVol);
    var price = rowNum(row, colIdx.price);
    var rev = rowNum(row, colIdx.revenue);
    var profit = rowNum(row, colIdx.profit);

    if (sales <= 0 && rev <= 0) return;

    var rowData = [
      standardizeLocation(rowVal(row, colIdx.location)),
      rowVal(row, colIdx.sku),
      rowVal(row, colIdx.description),
      sales,
      price > 0 ? price : '',
      rev > 0 ? rev : sales * price,
      profit,
    ];
    sheet.getRange(r, 1, 1, rowData.length).setValues([rowData]);

    totalRevenue += (rev > 0 ? rev : sales * price);
    totalUnits += sales;
    hasData = true;
    r++;
  });

  if (!hasData) writePlaceholder(sheet, r++, 'No sales data recorded for this period', colHeaders.length);
  else {
    r++;
    sheet.getRange(r, 1, 1, 3).setValues([['', 'TOTAL SALES', '']]);
    sheet.getRange(r, 4).setValue(totalUnits);
    sheet.getRange(r, 6).setValue(totalRevenue);
    sheet.getRange(r, 1, 1, 7).setFontWeight('bold');
    r++;
  }

  return r;
}

// =========================================================================
// Section 3: Goods Received (GRN)
// =========================================================================

function buildGRN(sheet, startRow, rows, colIdx) {
  var r = startRow;
  writeSectionHeader(sheet, r++, 1, 8, '3. GOODS RECEIVED (GRN)', 'Stock received from vendor/supplier', COLOR_ORANGE);

  var colHeaders = ['Location', 'SKU', 'Description', 'Qty Received', 'Date', 'Reference', 'Status'];
  writeHeaders(sheet, r++, colHeaders, '#fcd34d');

  writePlaceholder(sheet, r++, 'No GRN data — requires POS/GRN transaction records. Once uploaded via Combine step, this section auto-populates.', colHeaders.length);

  return r + 1;
}

// =========================================================================
// Section 4: Inventory Adjustment
// =========================================================================

function buildAdjustments(sheet, startRow, rows, colIdx) {
  var r = startRow;
  writeSectionHeader(sheet, r++, 1, 8, '4. INVENTORY ADJUSTMENT', 'Reconciliation entries and corrections', COLOR_PURPLE);

  var colHeaders = ['Location', 'SKU', 'Description', 'Adjustment', 'Type', 'Reason', 'Value Impact'];
  writeHeaders(sheet, r++, colHeaders, '#c4b5fd');

  var hasData = false;

  rows.forEach(function(row) {
    var received = rowVal(row, colIdx.received);
    var profit = rowNum(row, colIdx.profit);

    if (received && received !== '-' && received !== '0.00%') {
      var rowData = [
        standardizeLocation(rowVal(row, colIdx.location)),
        rowVal(row, colIdx.sku),
        rowVal(row, colIdx.description),
        received,
        'Variance',
        'Received vs expected variance',
        profit,
      ];
      sheet.getRange(r, 1, 1, rowData.length).setValues([rowData]);
      hasData = true;
      r++;
    }

    if (profit < 0 && profit !== 0) {
      var rowData2 = [
        standardizeLocation(rowVal(row, colIdx.location)),
        rowVal(row, colIdx.sku),
        rowVal(row, colIdx.description),
        profit,
        'Loss',
        'Negative profit — possible data entry or reconciliation entry',
        '',
      ];
      sheet.getRange(r, 1, 1, rowData2.length).setValues([rowData2]);
      hasData = true;
      r++;
    }
  });

  if (!hasData) writePlaceholder(sheet, r++, 'No adjustment data found. Reconciliation entries require POS transaction data.', colHeaders.length);

  return r + 1;
}

// =========================================================================
// Section 5: Location Transfer
// =========================================================================

function buildTransfers(sheet, startRow, rows, colIdx) {
  var r = startRow;
  writeSectionHeader(sheet, r++, 1, 8, '5. LOCATION TRANSFER', 'Inter-store stock movements', COLOR_TEAL);

  var colHeaders = ['From Location', 'To Location', 'SKU', 'Description', 'Qty', 'Date', 'Reference'];
  writeHeaders(sheet, r++, colHeaders, '#5eead4');

  var locations = {};
  rows.forEach(function(row) {
    var loc = standardizeLocation(rowVal(row, colIdx.location));
    if (loc) locations[loc] = true;
  });

  var locList = Object.keys(locations).sort();
  if (locList.length > 1) {
    var msg = 'Items found at ' + locList.length + ' locations: ' + locList.join(', ') +
              '. Transfer records require inter-store movement data from POS system.';
    writePlaceholder(sheet, r++, msg, colHeaders.length);
  } else {
    writePlaceholder(sheet, r++, 'No location transfer data. Items appear at a single location.', colHeaders.length);
  }

  return r + 1;
}

// =========================================================================
// Section 6: Closing Stock Balance
// =========================================================================

function buildClosingStock(sheet, startRow, rows, colIdx) {
  var r = startRow;
  writeSectionHeader(sheet, r++, 1, 8, '6. CLOSING STOCK BALANCE', 'End-of-period units on hand, by location', COLOR_RED);

  var colHeaders = ['Location', 'SKU', 'Description', 'Closing Qty', 'Unit Price', 'Valuation', 'Status'];
  writeHeaders(sheet, r++, colHeaders, '#fca5a5');

  var totalUnits = 0;
  var totalVal = 0;
  var hasData = false;

  rows.forEach(function(row) {
    var inv = rowNum(row, colIdx.inventory);
    var price = rowNum(row, colIdx.price);
    var val = inv * price;

    if (inv <= 0) return;

    var rowData = [
      standardizeLocation(rowVal(row, colIdx.location)),
      rowVal(row, colIdx.sku),
      rowVal(row, colIdx.description),
      inv,
      price > 0 ? price : '',
      val > 0 ? val : '',
      inv > 10 ? 'Healthy' : (inv > 0 ? 'Low stock' : 'Out of stock'),
    ];
    sheet.getRange(r, 1, 1, rowData.length).setValues([rowData]);
    totalUnits += inv;
    totalVal += val;
    hasData = true;
    r++;
  });

  if (!hasData) writePlaceholder(sheet, r++, 'No closing stock data available', colHeaders.length);
  else {
    r++;
    sheet.getRange(r, 1, 1, 3).setValues([['', 'TOTAL CLOSING STOCK', '']]);
    sheet.getRange(r, 4).setValue(totalUnits);
    sheet.getRange(r, 6).setValue(totalVal);
    sheet.getRange(r, 1, 1, 7).setFontWeight('bold');
    r++;
  }

  return r;
}

// =========================================================================
// Section 7: Revenue Due to Vendor
// =========================================================================

function buildRevenue(sheet, startRow, rows, colIdx) {
  var r = startRow;
  writeSectionHeader(sheet, r++, 1, 8, '7. REVENUE DUE TO VENDOR', 'Units sold × agreed consignment price per SKU', COLOR_DGREEN);

  var colHeaders = ['Location', 'SKU', 'Description', 'Units Sold', 'Consignment Price', 'Revenue Due', 'Notes'];
  writeHeaders(sheet, r++, colHeaders, '#6ee7b7');

  var totalRevenue = 0;
  var totalUnits = 0;
  var hasData = false;

  rows.forEach(function(row) {
    var sales = rowNum(row, colIdx.salesVol);
    var price = rowNum(row, colIdx.price);
    var rev = rowNum(row, colIdx.revenue);
    var revenueDue = rev > 0 ? rev : sales * price;

    if (revenueDue <= 0) return;

    var rowData = [
      standardizeLocation(rowVal(row, colIdx.location)),
      rowVal(row, colIdx.sku),
      rowVal(row, colIdx.description),
      sales,
      price > 0 ? price : '',
      revenueDue,
      rev <= 0 ? 'Estimated (units × price)' : '',
    ];
    sheet.getRange(r, 1, 1, rowData.length).setValues([rowData]);
    totalRevenue += revenueDue;
    totalUnits += sales;
    hasData = true;
    r++;
  });

  if (!hasData) writePlaceholder(sheet, r++, 'No revenue data available', colHeaders.length);
  else {
    r++;
    sheet.getRange(r, 1).setValue('');
    sheet.getRange(r, 2).setValue('TOTAL REVENUE DUE');
    sheet.getRange(r, 3).setValue(totalUnits + ' units');
    sheet.getRange(r, 5).setValue('');
    sheet.getRange(r, 6).setValue(totalRevenue);
    sheet.getRange(r, 1, 1, 7).setFontWeight('bold').setFontColor('#065f46');
    sheet.getRange(r, 6).setNumberFormat('$#,##0.00');
    r++;
  }

  return r;
}

// =========================================================================
// Summary
// =========================================================================

function buildReportSummary(sheet, startRow, partnerName, rows, colIdx) {
  var r = startRow;
  writeSectionHeader(sheet, r++, 1, 8, 'REPORT SUMMARY — ' + partnerName, '', '#e5e7eb');

  var totalSales = 0, totalRevenue = 0, totalInventory = 0, totalSKUs = 0;
  var skuSet = {};
  var locationSet = {};

  rows.forEach(function(row) {
    var loc = standardizeLocation(rowVal(row, colIdx.location));
    var sku = rowVal(row, colIdx.sku);
    var sales = rowNum(row, colIdx.salesVol);
    var rev = rowNum(row, colIdx.revenue);
    var inv = rowNum(row, colIdx.inventory);

    totalSales += sales;
    totalRevenue += (rev > 0 ? rev : sales * rowNum(row, colIdx.price));
    totalInventory += inv;
    if (sku) skuSet[sku] = true;
    if (loc) locationSet[loc] = true;
  });

  totalSKUs = Object.keys(skuSet).length;

  var summary = [
    ['Total Rows:', rows.length],
    ['Unique SKUs:', totalSKUs],
    ['Locations:', Object.keys(locationSet).join(', ')],
    ['Total Units Sold:', totalSales],
    ['Current Inventory:', totalInventory],
    ['Estimated Opening Stock:', totalInventory + totalSales],
    ['Total Revenue Due:', totalRevenue],
  ];

  summary.forEach(function(row) {
    sheet.getRange(r, 1).setValue(row[0]).setFontWeight('bold');
    sheet.getRange(r, 2).setValue(row[1]);
    if (row[0] === 'Total Revenue Due:') sheet.getRange(r, 2).setNumberFormat('$#,##0.00');
    r++;
  });

  r++;
  sheet.getRange(r, 1, 1, 7).merge();
  sheet.getRange(r++, 1).setValue('Report generated: ' + new Date().toISOString())
    .setFontSize(9).setFontColor('#9ca3af').setHorizontalAlignment('right');

  return r;
}

// =========================================================================
// Formatting helpers
// =========================================================================

function writeSectionHeader(sheet, row, colStart, colSpan, title, subtitle, color) {
  sheet.getRange(row, colStart, 1, colSpan).merge();
  sheet.getRange(row, colStart)
    .setValue(title)
    .setFontSize(12)
    .setFontWeight('bold')
    .setFontColor('#1f2937')
    .setBackground(color);

  if (subtitle) {
    sheet.getRange(row, colStart)
      .setValue(title + ' — ' + subtitle);
  }

  if (colSpan > 1) {
    for (var c = colStart + 1; c < colStart + colSpan; c++) {
      sheet.getRange(row, c).setBackground(color);
    }
  }
}

function writeHeaders(sheet, row, headers, color) {
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(row, 1, 1, headers.length).setFontWeight('bold').setFontSize(10).setBackground(color);
}

function writePlaceholder(sheet, row, message, colCount) {
  sheet.getRange(row, 1, 1, colCount || 7).merge();
  sheet.getRange(row, 1)
    .setValue(message)
    .setFontStyle('italic')
    .setFontSize(10)
    .setFontColor('#9ca3af')
    .setBackground(COLOR_GRAY);
}

function standardizeLocation(loc) {
  if (!loc) return '';
  var s = loc.toString().trim();
  var map = {
    'The Social Space (Kreta Ayer)': 'Kreta Ayer',
    'The Social Space (Potong Pasir)': 'Potong Pasir',
    'KRETA AYER': 'Kreta Ayer',
    'POTONG PASIR': 'Potong Pasir',
    'ONLINE STORE': 'Online',
  };
  return map[s] || s;
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

// =========================================================================
// Deprecated — kept for backward compatibility but generateReports() no
// longer uses these simple report builders.
// =========================================================================

function initMasterTab(sheet) {
  sheet.clear();
  sheet.getRange('A1').setValue('Run "1. Combine CSVs" from the menu to populate this tab.');
}

function initReviewLogTab(sheet) {
  sheet.clear();
  var headers = ['Row #', 'Column', 'Issue', 'Confidence', 'AI Action', 'Timestamp'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange('A1:F1').setFontWeight('bold');
}

function initWorkflowLogTab(sheet) {
  sheet.clear();
  var headers = ['Timestamp', 'Action', 'Details', 'Duration (s)'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange('A1:D1').setFontWeight('bold');
}
