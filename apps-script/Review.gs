/**
 * AI Review — multi-model review with cell comments and Knowledge tab integration.
 */

/**
 * Main entry: full AI review of Master tab.
 */
function runAIReview() {
  setStatus('Running AI review...', STATUS.REVIEWING);
  logEvent('review_start', 'Starting AI review');

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
    var batchSize = parseInt(getSetting('BATCH_SIZE', 'B5') || '25');

    var master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_MASTER);
    if (!master || master.getLastRow() < 2) {
      showAlert('Master tab is empty. Run "1. Combine CSVs" first.');
      setStatus('No data to review', STATUS.READY);
      return;
    }

    var headers = master.getRange(1, 1, 1, master.getLastColumn()).getValues()[0];
    var statusCol = headerIndex(headers, 'AI Review Status') + 1;
    var notesCol  = headerIndex(headers, 'AI Notes') + 1;
    var verifyCol = headerIndex(headers, 'Human Verified') + 1;

    var totalRows = master.getLastRow() - 1;
    var reviewed = 0;
    var autoFixed = 0;
    var flagged = 0;

    for (var start = 2; start <= master.getLastRow(); start += batchSize) {
      var batchEnd = Math.min(start + batchSize - 1, master.getLastRow());
      var batchData = master.getRange(start, 1, batchEnd - start + 1, master.getLastColumn()).getValues();

      for (var r = 0; r < batchData.length; r++) {
        var rowNum = start + r;

        if (batchData[r][verifyCol - 1] === true) continue; // skip verified

        var rowObj = {};
        headers.forEach(function(h, i) { rowObj[h] = batchData[r][i]; });

        // Check Knowledge tab first for known fixes
        var knownFixes = checkKnowledgeForRow(rowObj, headers);
        knownFixes.forEach(function(fix) {
          var colIdx = headerIndex(headers, fix.column) + 1;
          if (colIdx > 0) {
            master.getRange(rowNum, colIdx).setValue(fix.corrected);
            autoFixed++;
          }
          addReviewLogEntry(rowNum, fix.column, fix.issue, 1.0, 'auto (knowledge)');
        });

        // Skip columns that aren't reviewable
        var reviewCols = getReviewColumns(headers);

        // Build prompt for AI
        var prompt = buildReviewPrompt(rowObj, reviewCols);

        // Call AI
        var aiResponse = callAI(config, apiKey, prompt);
        var findings = parseFindings(aiResponse);

        findings.forEach(function(finding) {
          var colIdx = headerIndex(headers, finding.column) + 1;
          if (colIdx <= 0 || finding.action === 'ok') return;

          if (finding.action === 'fix' && finding.confidence >= confidenceThreshold) {
            // Auto-fix
            if (finding.new_value) {
              master.getRange(rowNum, colIdx).setValue(finding.new_value);
              autoFixed++;
            }
            addReviewLogEntry(rowNum, finding.column, finding.issue, finding.confidence, 'auto-fix');
          } else {
            // Flag for human — add cell comment
            var comment = buildCommentText(finding);
            master.getRange(rowNum, colIdx).setNote(comment);
            flagged++;
            addReviewLogEntry(rowNum, finding.column, finding.issue, finding.confidence, 'flagged');
          }
        });

        // Update row status
        var rowStatus = flagged > 0 ? 'needs_review' : 'reviewed_ok';
        if (statusCol > 0) master.getRange(rowNum, statusCol).setValue(rowStatus);

        reviewed++;
      }

      // Save progress
      PROPS.setProperty('REVIEW_PROGRESS', batchEnd.toString());
      setStatus('Reviewing... row ' + batchEnd + ' of ' + master.getLastRow(), STATUS.REVIEWING);
    }

    PROPS.deleteProperty('REVIEW_PROGRESS');

    logEvent('review_done',
      reviewed + ' rows reviewed, ' + autoFixed + ' auto-fixed, ' + flagged + ' flagged', '');
    setStatus(
      reviewed + ' rows reviewed — ' + autoFixed + ' fixed, ' + flagged + ' flagged for your review.',
      flagged > 0 ? STATUS.AWAITING_FIX : STATUS.DONE
    );

    showAlert(
      'AI Review complete.\n\n' +
      'Rows reviewed: ' + reviewed + '\n' +
      'Auto-fixed: ' + autoFixed + '\n' +
      'Flagged for you: ' + flagged + '\n\n' +
      'Review flagged cells (marked with notes). Fix them, then tick the "Human Verified" checkbox.\n\n' +
      'Tip: The Knowledge tab will learn from your corrections.'
    );

  } catch (e) {
    setStatus('Review error: ' + e.message, 'error');
    logEvent('review_error', e.message, '');
  }
}

/**
 * Re-runs AI review only on rows where Human Verified is not checked.
 */
function rerunAIReview() {
  setStatus('Re-running AI review (unverified only)...', STATUS.REVIEWING);
  logEvent('review_rerun', 'Starting re-review of unverified rows');
  runAIReview();
}

/**
 * Builds the review prompt for a single row.
 */
function buildReviewPrompt(rowObj, reviewCols) {
  var rowJson = {};
  reviewCols.forEach(function(col) {
    if (rowObj[col] !== undefined) {
      rowJson[col] = rowObj[col];
    }
  });

  return [
    'You are a data quality reviewer for a consignment reporting system.',
    'The Social Space is a Singapore social enterprise with 50+ consignment partners.',
    'Review this data row and check for: inconsistent naming, typos, outlier values,',
    'missing partner attribution, suspicious price/revenue ratios.', '',
    'Item categories represent consignment partners. Locations: Kreta Ayer, Potong Pasir, Online.',
    '',
    'Respond ONLY with a valid JSON array. Each element:',
    '{',
    '  "column": "column name",',
    '  "action": "fix" | "flag" | "ok",',
    '  "new_value": "corrected value or null",',
    '  "issue": "description of the issue",',
    '  "confidence": 0.0 to 1.0,',
    '  "context": "explanation for the human reviewer"',
    '}',
    '',
    'Only include entries where action is "fix" or "flag". Skip columns that look fine.',
    '',
    'Row data:',
    JSON.stringify(rowJson, null, 2),
  ].join('\n');
}

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
    throw new Error('AI API returned ' + code + ': ' + response.getContentText().substring(0, 200));
  }

  var json = JSON.parse(response.getContentText());
  return config.parseResponse(json);
}

/**
 * Parses AI response into structured findings.
 */
function parseFindings(aiResponse) {
  try {
    // Clean response — extract JSON array
    var jsonText = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    if (jsonText.indexOf('[') < 0 && jsonText.indexOf('{') >= 0) {
      jsonText = '[' + jsonText + ']';
    }
    var findings = JSON.parse(jsonText);
    if (!Array.isArray(findings)) findings = [findings];
    return findings;
  } catch (e) {
    // Fallback: treat as a single finding
    return [{ action: 'flag', column: 'unknown', issue: 'AI response parsing failed: ' + e.message, confidence: 0.5 }];
  }
}

/**
 * Builds a human-readable comment from a finding.
 */
function buildCommentText(finding) {
  return [
    '⚠ AI Review Issue',
    '',
    'Column: ' + finding.column,
    'Issue: ' + (finding.issue || 'Unclear'),
    'Confidence: ' + Math.round(finding.confidence * 100) + '%',
    '',
    'Context: ' + (finding.context || 'No additional context.'),
    '',
    'Suggested fix: ' + (finding.new_value || 'Please review manually.'),
    '',
    'Action: Fix this cell, then tick the "Human Verified" checkbox in this row.',
    'The Knowledge tab will learn from your correction.',
  ].join('\n');
}

/**
 * Adds an entry to the Review Log tab.
 */
function addReviewLogEntry(rowNum, column, issue, confidence, action) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_REVIEW_LOG);
  if (!sheet) return;
  sheet.appendRow([rowNum, column, issue, confidence, action, new Date()]);
}

/**
 * Returns the list of columns to review (excluding system columns).
 */
function getReviewColumns(headers) {
  var skip = ['_source_file', '_ingested_at', 'AI Review Status', 'AI Notes', 'Human Verified', '_sheet_name'];
  return headers.filter(function(h) { return skip.indexOf(h) < 0; });
}
