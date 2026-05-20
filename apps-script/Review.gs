/**
 * AI Review — two-pass approach.
 *
 * Pass 1: Send dataset summary → AI identifies column-wide issues + suspect row ranges (1-2 API calls)
 * Pass 2: Zoom — detailed review only on rows flagged by Pass 1 (~20-40 API calls)
 *
 * Pre-filter runs first: Knowledge tab fixes + simple heuristics (0 API calls)
 */

/**
 * Main entry: full AI review of Master tab.
 */
function runAIReview() {
  setStatus('Running AI review...', STATUS.REVIEWING);
  // Status values for AI Review Status column
  var STATUS_CLEARED    = 'Cleared';
  var STATUS_AUTOFIXED  = 'Auto-fixed';
  var STATUS_NEEDSRVW   = 'Needs Review';
  var STATUS_PENDING    = 'Pending';

  var startTime = new Date().getTime();
  logEvent('review_start', 'Starting two-pass AI review');

  try {
    saveAllSettings();
    var apiKey = PROPS.getProperty('API_KEY');
    if (!apiKey) {
      showAlert('No API key saved. Go to Settings ▸ Save API Key first.');
      setStatus('Error: No API key', 'error');
      return;
    }

    var config = getModelConfig();
    var confidenceThreshold = parseFloat(getSetting('CONFIDENCE', 'B4') || '0.85');

    var master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_MASTER);
    if (!master || master.getLastRow() < 2) {
      showAlert('Master tab is empty. Run "1. Combine CSVs" first.');
      setStatus('No data to review', STATUS.READY);
      return;
    }

    var headers = master.getRange(1, 1, 1, master.getLastColumn()).getValues()[0];
    var statusCol = headerIndex(headers, 'AI Review Status') + 1;
    var verifyCol = headerIndex(headers, 'Human Verified') + 1;

    var allData = master.getRange(2, 1, master.getLastRow() - 1, master.getLastColumn()).getValues();
    var totalRows = allData.length;

    var preFixCount = 0;
    var reviewCols = getReviewColumns(headers);

    // -----------------------------------------------------------------------
    // Step 0: Pre-filter — Knowledge tab + heuristics (0 API calls)
    // -----------------------------------------------------------------------
    setStatus('Pre-filtering ' + totalRows + ' rows (Knowledge tab + heuristics)...', STATUS.REVIEWING);

    for (var r = 0; r < allData.length; r++) {
      var rowNum = r + 2;
      if (allData[r][verifyCol - 1] === true) continue;

      // A. Knowledge tab fixes
      var rowObj = {};
      headers.forEach(function(h, i) { rowObj[h] = allData[r][i]; });

      var knownFixes = checkKnowledgeForRow(rowObj, headers);
      knownFixes.forEach(function(fix) {
        var colIdx = headerIndex(headers, fix.column) + 1;
        if (colIdx > 0) {
          master.getRange(rowNum, colIdx).setValue(fix.corrected);
          allData[r][colIdx - 1] = fix.corrected;
          preFixCount++;
        }
        addReviewLogEntry(rowNum, fix.column, fix.issue, 1.0, 'auto (knowledge)');
      });

      // B. Quick heuristics
      var heuristicFixes = runHeuristics(allData[r], headers);
      heuristicFixes.forEach(function(fix) {
        var colIdx = headerIndex(headers, fix.column) + 1;
        if (colIdx > 0) {
          master.getRange(rowNum, colIdx).setValue(fix.corrected);
          allData[r][colIdx - 1] = fix.corrected;
          preFixCount++;
        }
        addReviewLogEntry(rowNum, fix.column, fix.issue, 0.95, 'auto (heuristic)');
      });
    }

    setStatus('Pre-filter done: ' + preFixCount + ' fixes. Running Pass 1 scan...', STATUS.REVIEWING);
    SpreadsheetApp.flush();

    // -----------------------------------------------------------------------
    // Step 1: Pass 1 — Dataset summary scan (1 API call)
    // -----------------------------------------------------------------------
    var summary = buildDatasetSummary(allData, headers, reviewCols);
    var scanPrompt = buildScanPrompt(summary, totalRows, reviewCols);
    var scanResponse = callAI(config, apiKey, scanPrompt);
    var flaggedRows = parseScanResults(scanResponse, totalRows);

    // If AI returned nothing useful, fall back to sampling
    if (!flaggedRows || flaggedRows.length === 0) {
      flaggedRows = fallbackSampling(totalRows);
      logEvent('review_pass1', 'Fallback: sampling every 5th row (' + flaggedRows.length + ' rows)', '');
    } else {
      // Deduplicate and sort flagged rows
      flaggedRows = flaggedRows.filter(function(r) { return r > 0 && r <= totalRows; });
      flaggedRows = unique(flaggedRows).sort(function(a, b) { return a - b; });
      logEvent('review_pass1', 'Pass 1 flagged ' + flaggedRows.length + ' rows for zoom review', '');
    }

    setStatus('Pass 1 done: ' + flaggedRows.length + ' rows to zoom-review. Running Pass 2...', STATUS.REVIEWING);

    // -----------------------------------------------------------------------
    // Step 2: Pass 2 — Zoom review only on flagged rows
    // -----------------------------------------------------------------------
    var autoFixed = preFixCount;
    var flaggedCount = 0;
    var zoomReviewed = 0;

    var batchSize = 20;
    for (var b = 0; b < flaggedRows.length; b += batchSize) {
      var batchRows = flaggedRows.slice(b, Math.min(b + batchSize, flaggedRows.length));

      for (var bi = 0; bi < batchRows.length; bi++) {
        var rIdx = batchRows[bi] - 1;
        var rowNum = batchRows[bi] + 1;

        if (allData[rIdx][verifyCol - 1] === true) continue;

        var rowObj = {};
        headers.forEach(function(h, i) { rowObj[h] = allData[rIdx][i]; });

        var prompt = buildRowPrompt(rowObj, reviewCols);
        var aiResponse = callAI(config, apiKey, prompt);
        var findings = parseFindings(aiResponse);

        var rowFlags = 0;
        var rowAutoFixes = 0;
        findings.forEach(function(finding) {
          var colIdx = headerIndex(headers, finding.column) + 1;
          if (colIdx <= 0 || finding.action === 'ok') return;

          if (finding.action === 'fix' && finding.confidence >= confidenceThreshold) {
            if (finding.new_value) {
              master.getRange(rowNum, colIdx).setValue(finding.new_value);
              autoFixed++;
              rowAutoFixes++;
            }
            addReviewLogEntry(rowNum, finding.column, finding.issue, finding.confidence, 'auto-fix');
          } else {
            var comment = buildCommentText(finding);
            master.getRange(rowNum, colIdx).setNote(comment);
            flaggedCount++;
            rowFlags++;
            addReviewLogEntry(rowNum, finding.column, finding.issue, finding.confidence, 'flagged');
          }
        });

        // Set status based on combined pre-filter + AI results
        var rowStatus;
        if (rowFlags > 0) {
          rowStatus = STATUS_NEEDSRV;
        } else if (rowAutoFixes > 0) {
          rowStatus = STATUS_AUTOFIXED;
        } else {
          rowStatus = STATUS_CLEARED;
        }
        if (statusCol > 0) master.getRange(rowNum, statusCol).setValue(rowStatus);
        zoomReviewed++;
      }

      var pct = Math.round((b + batchRows.length) / flaggedRows.length * 100);
      setStatus('Zoom review: ' + pct + '% (' + zoomReviewed + '/' + flaggedRows.length + ' rows)', STATUS.REVIEWING);
    }

    // Set Cleared status on all remaining Pending rows (they were never flagged)
    if (statusCol > 0) {
      var finalStatuses = master.getRange(2, statusCol, master.getLastRow() - 1, 1).getValues();
      for (var fs = 0; fs < finalStatuses.length; fs++) {
        if (finalStatuses[fs][0] === 'Pending') {
          master.getRange(fs + 2, statusCol).setValue(STATUS_CLEARED);
        }
      }
    }

    // Insert checkboxes ONLY on rows flagged for review
    if (verifyCol > 0 && flaggedCount > 0) {
      var allStatuses = master.getRange(2, statusCol, master.getLastRow() - 1, 1).getValues();
      for (var rs = 0; rs < allStatuses.length; rs++) {
        if (allStatuses[rs][0] === STATUS_NEEDSRV) {
          master.getRange(rs + 2, verifyCol).insertCheckboxes();
        }
      }
    }

    var elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);
    logEvent('review_done',
      totalRows + ' rows, ' + autoFixed + ' auto-fixed, ' + flaggedCount + ' flagged (' + elapsed + 's)', elapsed);

    setStatus(
      totalRows + ' rows — ' + autoFixed + ' fixed, ' + flaggedCount + ' flagged (' + elapsed + 's).',
      flaggedCount > 0 ? STATUS.AWAITING_FIX : STATUS.DONE
    );

    showAlert(
      'AI Review complete (' + elapsed + 's).\n\n' +
      'Pass 1 scanned all ' + totalRows + ' rows\n' +
      'Pass 2 zoom-reviewed ' + zoomReviewed + ' flagged rows\n\n' +
      'Cleared: ' + (zoomReviewed - (flaggedCount + (autoFixed - preFixCount))) + ' rows\n' +
      'Auto-fixed: ' + autoFixed + '\n' +
      'Needs Review: ' + flaggedCount + ' (checkboxes added)\n\n' +
      'Review flagged cells (marked with notes). Fix them, then tick the "Human Verified" checkbox.\n' +
      'Cells already cleared or auto-fixed do NOT need verification.'
    );

  } catch (e) {
    setStatus('Review error: ' + e.message, 'error');
    logEvent('review_error', e.message, '');
  }
}

/**
 * Re-runs AI review only on unverified rows.
 */
function rerunAIReview() {
  setStatus('Re-running AI review (unverified only)...', STATUS.REVIEWING);
  logEvent('review_rerun', 'Starting re-review of unverified rows');
  runAIReview();
}

// ---------------------------------------------------------------------------
// Pre-filter: Heuristics (no API calls)
// ---------------------------------------------------------------------------

/**
 * Quick heuristic checks on a single row. No API calls.
 * Focuses on content issues: typos, similar names, outliers, logic errors.
 * Empty cells are pre-highlighted in ingestion — not re-checked here.
 * Returns [{column, corrected, issue}].
 */
function runHeuristics(row, headers) {
  var fixes = [];

  function val(name) {
    var idx = headerIndex(headers, name);
    return idx >= 0 ? (row[idx] ? row[idx].toString().trim() : '') : '';
  }

  // Fuzzy name check against known valid values
  var partnerCols = ['Item supplier (Partner)', 'Item category', 'item_category', 'partner'];
  partnerCols.forEach(function(pc) {
    var pv = val(pc);
    if (!pv) return;

    // Check Knowledge tab for close matches (e.g., 'Riau Candle' → 'Riau Candles')
    var knowledge = loadKnowledgeTab();
    if (knowledge[pc]) {
      // Check if value is close to a known correction
      var knownCorrected = knowledge[pc][pv];
      if (knownCorrected && knownCorrected !== pv) {
        fixes.push({ column: pc, corrected: knownCorrected,
          issue: 'Corrected partner name: "' + pv + '" → "' + knownCorrected + '" — from Knowledge tab' });
        return;
      }
    }
  });

  // Negative quantities
  var qtyCols = ['Sales volume', 'Current Inventory'];
  qtyCols.forEach(function(qc) {
    var qv = val(qc);
    if (!qv) return;
    var num = parseFloat(qv);
    if (!isNaN(num) && num < 0) {
      fixes.push({ column: qc, corrected: String(Math.abs(num)),
        issue: 'Negative quantity corrected: ' + qv + ' → ' + Math.abs(num) });
    }
  });

  // Unassigned categories
  var catCols = ['Item category', 'item_category', 'partner'];
  catCols.forEach(function(cc) {
    var cv = val(cc);
    if (!cv) return;
    if (['无', 'nothing', 'others', '-', 'hidden items'].indexOf(cv.toLowerCase()) >= 0) {
      fixes.push({ column: cc, corrected: cv,
        issue: 'Unassigned category: "' + cv + '" — needs partner assignment' });
    }
  });

  return fixes;
}

// ---------------------------------------------------------------------------
// Pass 1: Dataset Summary Scan
// ---------------------------------------------------------------------------

/**
 * Builds a compact statistical summary of the dataset.
 */
function buildDatasetSummary(allData, headers, reviewCols) {
  var summary = { total_rows: allData.length, columns: {} };

  reviewCols.forEach(function(col) {
    var idx = headerIndex(headers, col);
    if (idx < 0) return;

    var values = allData.map(function(row) {
      var v = row[idx];
      return (v !== undefined && v !== null && v !== '') ? v.toString().trim() : null;
    }).filter(function(v) { return v !== null; });

    var colInfo = { count: values.length, null_pct: ((allData.length - values.length) / allData.length * 100).toFixed(1) };

    // For categorical columns — show unique values and frequencies
    if (col.toLowerCase().indexOf('category') >= 0 || col.toLowerCase().indexOf('partner') >= 0 ||
        col.toLowerCase().indexOf('outlet') >= 0 || col.toLowerCase().indexOf('location') >= 0 ||
        col.toLowerCase().indexOf('brand') >= 0 || col.toLowerCase().indexOf('source') >= 0) {

      var freq = {};
      values.forEach(function(v) { freq[v] = (freq[v] || 0) + 1; });
      var sorted = Object.keys(freq).sort(function(a, b) { return freq[b] - freq[a]; });
      colInfo.type = 'categorical';
      colInfo.unique_count = sorted.length;
      colInfo.top_values = sorted.slice(0, 15).map(function(v) { return { value: v, count: freq[v] }; });
      colInfo.tail_values = sorted.slice(-5).map(function(v) { return { value: v, count: freq[v] }; });

    // For numeric columns — show range and outliers
    } else {
      try {
        var nums = values.map(function(v) { return parseFloat(v); }).filter(function(v) { return !isNaN(v); });
        if (nums.length > 0) {
          nums.sort(function(a, b) { return a - b; });
          colInfo.type = 'numeric';
          colInfo.min = nums[0];
          colInfo.max = nums[nums.length - 1];
          colInfo.median = nums[Math.floor(nums.length / 2)];
          colInfo.zeros = nums.filter(function(v) { return v === 0; }).length;
          colInfo.negatives = nums.filter(function(v) { return v < 0; }).length;
          colInfo.top_outliers = nums.slice(-5);
        }
      } catch(e) {}
    }

    summary.columns[col] = colInfo;
  });

  return summary;
}

/**
 * Builds the Pass 1 prompt: asks AI to find patterns and flag row ranges.
 */
function buildScanPrompt(summary, totalRows, reviewCols) {
  return [
    'You are a data quality reviewer for a consignment reporting system.',
    'The Social Space is a Singapore social enterprise with 50+ consignment partners.',
    '',
    'I am sending you a STATISTICAL SUMMARY of ' + totalRows + ' rows of data.',
    'DO NOT review individual rows. Find column-level patterns and problems.',
    '',
    'IMPORTANT: DO NOT flag empty or missing cells — those are pre-highlighted.',
    'Focus ONLY on:',
    '  - Similar-sounding names that might be typos (e.g., "Riau Candle" vs "Riau Candles")',
    '  - Mathematical errors or illogical values (revenue ≠ units × price)',
    '  - Clearly wrong quantities or outliers',
    '  - Misspelled locations, categories, or partner names',
    '  - Values that look like they belong in a different column',
    '  - Suspicious patterns (repeated values, impossible numbers)',
    '',
    'Dataset context:',
    '- Item categories represent consignment partners (39+ unique partners)',
    '- Locations: Kreta Ayer, Potong Pasir, Online',
    '- Revenue and Sales columns should be positive numbers',
    '',
    'Respond ONLY with a JSON object:',
    '{',
    '  "column_issues": [',
    '    { "column": "column_name", "issue": "description", "fix_pattern": "what to replace with" }',
    '  ],',
    '  "suspicious_row_ranges": [',
    '    { "from": row_number, "to": row_number, "reason": "why", "column": "affected_column" }',
    '  ]',
    '}',
    '',
    'Column summary:',
    JSON.stringify(summary, null, 2),
  ].join('\n');
}

/**
 * Parses Pass 1 scan results into an array of flagged row numbers.
 */
function parseScanResults(aiResponse, totalRows) {
  try {
    var result = JSON.parse(extractJSON(aiResponse));
    var rows = [];

    // Add row ranges flagged by AI
    if (result.suspicious_row_ranges) {
      result.suspicious_row_ranges.forEach(function(range) {
        for (var r = range.from || 1; r <= Math.min(range.to || range.from, totalRows); r++) {
          rows.push(r);
        }
      });
    }

    // If column-level issues found, sample rows with those column patterns
    if (result.column_issues && result.column_issues.length > 0) {
      // Include a sample for each column issue
      addReviewLogEntry(0, 'SYSTEM', 'Pass 1 found ' + result.column_issues.length + ' column-level issues', 1.0, 'column_issue');
    }

    // If no specific rows but column issues exist, sample every 4th row
    if (rows.length === 0 && result.column_issues && result.column_issues.length > 0) {
      for (var r = 1; r <= totalRows; r += 4) rows.push(r);
    }

    return rows;
  } catch (e) {
    return fallbackSampling(totalRows);
  }
}

/**
 * Fallback: sample every 5th row when AI can't produce a useful scan result.
 */
function fallbackSampling(totalRows) {
  var rows = [];
  var step = Math.ceil(totalRows / 30); // ~30 samples
  if (step < 3) step = 3;
  for (var r = 1; r <= totalRows; r += step) rows.push(r);
  return rows;
}

// ---------------------------------------------------------------------------
// Pass 2: Row-level zoom review
// ---------------------------------------------------------------------------

/**
 * Builds a row review prompt for Pass 2.
 */
function buildRowPrompt(rowObj, reviewCols) {
  var rowJson = {};
  reviewCols.forEach(function(col) {
    if (rowObj[col] !== undefined && rowObj[col] !== null && rowObj[col] !== '') {
      rowJson[col] = rowObj[col];
    }
  });

  return [
    'You are a data quality reviewer. Review this row for CONTENT issues only.',
    'DO NOT flag empty or missing cells.',
    'Check for: typos, similar-sounding names, mathematical inconsistency, illogical values,',
    'outlier quantities, misspelled locations/partners, values in wrong columns.',
    '',
    'Respond ONLY with a JSON array:',
    '[{ "column": "col", "action": "fix"|"flag"|"ok", "new_value": "or null", "issue": "...", "confidence": 0.9, "context": "..." }]',
    '',
    'Row: ' + JSON.stringify(rowJson),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * Calls the selected AI model API.
 */
function callAI(config, apiKey, prompt) {
  var headers = config.buildHeaders(apiKey);
  var body = config.buildBody(prompt);

  var options = {
    method: 'post',
    headers: headers,
    payload: body,
    muteHttpExceptions: true,
    contentType: 'application/json',
  };

  var response = UrlFetchApp.fetch(config.endpoint, options);
  var code = response.getResponseCode();

  if (code !== 200) {
    throw new Error('AI API returned ' + code + ': ' + response.getContentText().substring(0, 300));
  }

  var json = JSON.parse(response.getContentText());
  return config.parseResponse(json);
}

/**
 * Parses AI response into structured findings array.
 */
function parseFindings(aiResponse) {
  try {
    var jsonText = extractJSON(aiResponse);
    if (jsonText.indexOf('[') < 0 && jsonText.indexOf('{') >= 0) {
      jsonText = '[' + jsonText + ']';
    }
    var findings = JSON.parse(jsonText);
    if (!Array.isArray(findings)) findings = [findings];
    return findings;
  } catch (e) {
    return [{ action: 'flag', column: 'unknown', issue: 'AI response parsing failed: ' + e.message, confidence: 0.3 }];
  }
}

/**
 * Builds a human-readable cell comment from a finding.
 */
function buildCommentText(finding) {
  return [
    '⚠ AI Review Issue',
    '',
    'Column: ' + finding.column,
    'Issue: ' + (finding.issue || 'Unclear'),
    'Confidence: ' + Math.round((finding.confidence || 0.5) * 100) + '%',
    '',
    'Context: ' + (finding.context || 'No additional context.'),
    '',
    (finding.new_value ? 'Suggested fix: ' + finding.new_value : 'Please review manually.'),
    '',
    'Action: Fix this cell, then tick "Human Verified" in this row.',
  ].join('\n');
}

/**
 * Adds an entry to the Review Log tab with a hyperlink to the affected cell.
 */
function addReviewLogEntry(rowNum, column, issue, confidence, action) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_REVIEW_LOG);
  if (!sheet) return;

  // Build hyperlink to the specific cell in the Master tab
  var master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_MASTER);
  var masterGid = master ? master.getSheetId() : 0;
  var headers = master ? master.getRange(1, 1, 1, master.getLastColumn()).getValues()[0] : [];
  var colIdx = headerIndex(headers, column) + 1;
  var colLetter = colIdx > 0 ? columnIndexToLetter(colIdx) : 'A';
  var cellLink = '#gid=' + masterGid + '&range=' + colLetter + rowNum;

  var linkFormula = '=HYPERLINK("' + cellLink + '", "Row ' + rowNum + ', ' + colLetter + '")';
  sheet.appendRow([rowNum, column, issue, confidence, action, linkFormula, new Date()]);
}

/**
 * Convert 1-based column index to letter (1→A, 27→AA).
 */
function columnIndexToLetter(index) {
  var letter = '';
  while (index > 0) {
    var rem = (index - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    index = Math.floor((index - rem) / 26);
  }
  return letter;
}

/**
 * Returns reviewable columns (excludes system columns).
 */
function getReviewColumns(headers) {
  var skip = ['_source_file', '_ingested_at', 'AI Review Status', 'AI Notes', 'Human Verified', '_sheet_name'];
  return headers.filter(function(h) { return skip.indexOf(h) < 0; });
}

/**
 * Deduplicate array.
 */
function unique(arr) {
  return arr.filter(function(v, i, a) { return a.indexOf(v) === i; });
}
