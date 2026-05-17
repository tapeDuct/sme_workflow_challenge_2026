/**
 * Settings tab management and PropertiesService helpers.
 */

var DEFAULT_FOLDER_IDS = {
  DROP_CSV:           '',
  ARCHIVE_COMBINED:   '',
  ARCHIVE_CSV:         '',
  REPORTS:             '',
};

/**
 * Initializes the Settings tab with headers and defaults.
 */
function initSettingsTab(sheet) {
  sheet.clear();
  var headers = [
    ['Setting', 'Value', 'Description'],
    ['AI Model', 'Gemini 2.5 Flash', 'Dropdown: Gemini, Qwen, OpenAI, Custom'],
    ['API Key', '', 'Starts with sk- or AIza... Saved to PropertiesService'],
    ['Confidence Threshold', '0.85', 'AI auto-corrects above this. Below → flag for human'],
    ['Batch Size', '25', 'Rows to review per batch (keep under 50)'],
    ['Drop CSV Folder ID', '', 'Google Drive folder ID for CSV uploads'],
    ['Archive Combined Folder ID', '', 'Where master sheets go after confirmation'],
    ['Archive CSV Folder ID', '', 'Where processed CSVs are archived'],
    ['Reports Folder ID', '', 'Where per-partner report sheets are generated'],
    ['Custom Endpoint', '', 'API endpoint URL for custom model'],
    ['Custom Auth Header', '', 'e.g. Authorization: Bearer KEY'],
    ['Custom Body Template', '', 'JSON template with {{prompt}} placeholder'],
    ['Custom Parse Path', '', 'e.g. choices[0].message.content'],
  ];

  sheet.getRange(1, 1, headers.length, 3).setValues(headers);
  sheet.getRange('A1:C1').setFontWeight('bold');
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 360);
  sheet.setColumnWidth(3, 300);

  // Dropdown for AI model
  var modelCell = sheet.getRange('B2');
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Gemini 2.5 Flash', 'Qwen (Alibaba)', 'OpenAI', 'Custom'], true)
    .build();
  modelCell.setDataValidation(rule);

  // Load saved values
  loadSettingsFromProperties();
}

/**
 * Loads saved settings from PropertiesService into the Settings tab.
 */
function loadSettingsFromProperties() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_SETTINGS);
  if (!sheet) return;

  var keys = ['AI_MODEL', 'API_KEY', 'CONFIDENCE', 'BATCH_SIZE',
              'DROP_FOLDER', 'ARCHIVE_COMBINED', 'ARCHIVE_CSV', 'REPORTS_FOLDER',
              'CUSTOM_ENDPOINT', 'CUSTOM_AUTH', 'CUSTOM_BODY', 'CUSTOM_PARSE'];

  var map = {
    'AI_MODEL': 'B2',          'API_KEY': 'B3',
    'CONFIDENCE': 'B4',        'BATCH_SIZE': 'B5',
    'DROP_FOLDER': 'B6',       'ARCHIVE_COMBINED': 'B7',
    'ARCHIVE_CSV': 'B8',       'REPORTS_FOLDER': 'B9',
    'CUSTOM_ENDPOINT': 'B10',   'CUSTOM_AUTH': 'B11',
    'CUSTOM_BODY': 'B12',      'CUSTOM_PARSE': 'B13',
  };

  keys.forEach(function(key) {
    var value = PROPS.getProperty(key);
    if (value && map[key]) {
      if (key === 'API_KEY') value = maskValue(value);
      sheet.getRange(map[key]).setValue(value);
    }
  });
}

/**
 * Saves the API key to PropertiesService (never persisted in the sheet).
 */
function saveApiKey() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_SETTINGS);
  if (!sheet) return;

  var key = sheet.getRange('B3').getValue();
  if (!key || key.toString().trim() === '') {
    ui.alert('No API key entered.');
    return;
  }

  PROPS.setProperty('API_KEY', key.toString().trim());

  // Save all settings
  saveAllSettings();

  sheet.getRange('B3').setValue(maskValue(key.toString().trim()));
  ui.alert('API key saved securely to PropertiesService.');
}

/**
 * Saves all Settings tab values to PropertiesService.
 */
function saveAllSettings() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_SETTINGS);
  if (!sheet) return;

  var map = {
    'B2': 'AI_MODEL',          'B3': 'API_KEY',
    'B4': 'CONFIDENCE',        'B5': 'BATCH_SIZE',
    'B6': 'DROP_FOLDER',       'B7': 'ARCHIVE_COMBINED',
    'B8': 'ARCHIVE_CSV',       'B9': 'REPORTS_FOLDER',
    'B10': 'CUSTOM_ENDPOINT',   'B11': 'CUSTOM_AUTH',
    'B12': 'CUSTOM_BODY',      'B13': 'CUSTOM_PARSE',
  };

  Object.keys(map).forEach(function(cellRef) {
    var val = sheet.getRange(cellRef).getValue();
    if (val && val.toString().indexOf('••••') < 0) {
      PROPS.setProperty(map[cellRef], val.toString().trim());
    }
  });
}

/**
 * Reads a setting value, checking PropertiesService first, then the Settings tab.
 */
function getSetting(key, cellRef) {
  var propVal = PROPS.getProperty(key);
  if (propVal) return propVal;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_SETTINGS);
  if (!sheet) return '';

  var val = sheet.getRange(cellRef).getValue();
  return val ? val.toString().trim() : '';
}

/**
 * Mask a value for display (show first 4 and last 4 chars).
 */
function maskValue(value) {
  if (!value) return '';
  var s = value.toString();
  if (s.length <= 8) return '••••••••';
  return s.substring(0, 4) + '••••••••' + s.substring(s.length - 4);
}

/**
 * Get the model configuration for the currently selected model.
 */
function getModelConfig() {
  var model = getSetting('AI_MODEL', 'B2');

  var configs = {
    'Gemini 2.5 Flash': {
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      buildHeaders: function(key) { return { 'x-goog-api-key': key }; },
      buildBody: function(prompt) {
        return JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
        });
      },
      parseResponse: function(json) {
        return json.candidates[0].content.parts[0].text;
      },
      method: 'post',
    },
    'Qwen (Alibaba)': {
      endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      buildHeaders: function(key) { return { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }; },
      buildBody: function(prompt) {
        return JSON.stringify({
          model: 'qwen-plus',
          messages: [{ role: 'system', content: 'You are a data quality reviewer. Respond with JSON only.' },
                     { role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 4096,
        });
      },
      parseResponse: function(json) { return json.choices[0].message.content; },
      method: 'post',
    },
    'OpenAI': {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      buildHeaders: function(key) { return { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }; },
      buildBody: function(prompt) {
        return JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: 'You are a data quality reviewer. Respond with JSON only.' },
                     { role: 'user', content: prompt }],
          temperature: 0.1,
        });
      },
      parseResponse: function(json) { return json.choices[0].message.content; },
      method: 'post',
    },
    'Custom': {
      endpoint: getSetting('CUSTOM_ENDPOINT', 'B10'),
      buildHeaders: function(key) {
        var headerStr = getSetting('CUSTOM_AUTH', 'B11');
        var h = {};
        if (headerStr) {
          var parts = headerStr.split(':');
          if (parts.length >= 2) h[parts[0].trim()] = parts.slice(1).join(':').trim().replace('KEY', key);
        }
        h['Content-Type'] = 'application/json';
        return h;
      },
      buildBody: function(prompt) {
        var tmpl = getSetting('CUSTOM_BODY', 'B12');
        if (tmpl) return tmpl.replace('{{prompt}}', prompt.replace(/\n/g, '\\n').replace(/"/g, '\\"'));
        return JSON.stringify({ prompt: prompt });
      },
      parseResponse: function(json) {
        var path = getSetting('CUSTOM_PARSE', 'B13');
        if (!path) return JSON.stringify(json);
        var parts = path.split('.');
        var result = json;
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          var idxMatch = p.match(/^(\w+)\[(\d+)\]$/);
          if (idxMatch) {
            result = result[idxMatch[1]] ? result[idxMatch[1]][parseInt(idxMatch[2])] : null;
          } else {
            result = result[p];
          }
          if (result === undefined || result === null) break;
        }
        return result || JSON.stringify(json);
      },
      method: 'post',
    },
  };

  return configs[model] || configs['Gemini 2.0 Flash'];
}
