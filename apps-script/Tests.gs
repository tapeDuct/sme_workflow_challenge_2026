/**
 * Tests — run from Apps Script editor: Run → Run function → runTests
 */

function runTests() {
  var results = [];
  var passed = 0;
  var failed = 0;

  function assert(condition, name) {
    if (condition) {
      passed++;
      results.push('[PASS] ' + name);
    } else {
      failed++;
      results.push('[FAIL] ' + name);
    }
  }

  // Test: headerIndex
  var h = ['Name', 'Age', 'City'];
  assert(headerIndex(h, 'Name') === 0, 'headerIndex finds first column');
  assert(headerIndex(h, 'Age') === 1, 'headerIndex finds middle column');
  assert(headerIndex(h, 'city') === 2, 'headerIndex is case-insensitive');
  assert(headerIndex(h, 'unknown') === -1, 'headerIndex returns -1 for missing');

  // Test: parseCSVContent
  var csv = 'Name,Age,City\nAlice,30,"New York"\nBob,25,"Los Angeles"';
  var parsed = parseCSVContent(csv);
  assert(parsed.length === 3, 'parseCSVContent has header + 2 rows');
  assert(parsed[0][0] === 'Name', 'parseCSVContent parses header');
  assert(parsed[1][2] === 'New York', 'parseCSVContent handles quoted commas');

  // Test: findColumn
  assert(findColumn(h, ['unknown', 'city', 'name']) === 2, 'findColumn returns first match index');
  assert(findColumn(h, ['nope', 'no']) === -1, 'findColumn returns -1 when no match');

  // Test: sanitizeSheetName
  assert(sanitizeSheetName('Test:100') === 'Test_100', 'sanitizeSheetName replaces colon');
  assert(sanitizeSheetName("Don't") === 'Dont', 'sanitizeSheetName removes apostrophe');

  // Test: extractJSON
  var mdJson = '```json\n{"key": "value"}\n```';
  assert(extractJSON(mdJson).indexOf('"key"') >= 0, 'extractJSON strips markdown');

  // Test: safeParseFloat
  assert(safeParseFloat('3.14') === 3.14, 'safeParseFloat parses number');
  assert(safeParseFloat('abc', 5) === 5, 'safeParseFloat returns default on invalid');

  // Test: maskValue
  assert(maskValue('sk-test12345678') === 'sk-t••••••••5678', 'maskValue masks middle');

  // Summary
  var summary = '\n=== Test Results ===\n' +
                passed + ' passed, ' + failed + ' failed\n' +
                'Total: ' + (passed + failed) + '\n' +
                '=====================\n';
  results.push(summary);
  Logger.log(results.join('\n'));
}

/**
 * Run this from Apps Script to seed the Settings tab.
 */
function setupSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabsExist();
  var sheet = ss.getSheetByName(TAB_SETTINGS);
  if (sheet) {
    initSettingsTab(sheet);
  }
  var kb = ss.getSheetByName(TAB_KNOWLEDGE);
  if (kb) {
    initKnowledgeTab(kb);
  }
  Logger.log('Settings and Knowledge tabs initialized.');
}
