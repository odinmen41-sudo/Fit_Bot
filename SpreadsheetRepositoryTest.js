/**
 * C-01 — TEST-ONLY read repository for spreadsheet-backed architecture layers.
 *
 * The repository never resolves an active spreadsheet. Callers must inject either
 * an already-created repository or an explicit spreadsheet_id + provider pair.
 */
const SPREADSHEET_REPOSITORY_TEST_CONFIG = Object.freeze({
  ID_PROPERTY: "SPREADSHEET_REPOSITORY_TEST_ID",
  VALUE_MODE: Object.freeze({
    DISPLAY: "DISPLAY",
    RAW: "RAW"
  })
});

function createSpreadsheetRepositoryTest_(context) {
  const config = context || {};
  const spreadsheetId = String(config.spreadsheet_id || "").trim();
  const provider = config.provider;
  if (!spreadsheetId) throw new Error("SPREADSHEET_REPOSITORY_ID_REQUIRED");
  if (!provider || typeof provider.openById !== "function") {
    throw new Error("SPREADSHEET_REPOSITORY_PROVIDER_INVALID");
  }

  let spreadsheet;
  try {
    spreadsheet = provider.openById(spreadsheetId);
  } catch (error) {
    throw new Error("SPREADSHEET_REPOSITORY_OPEN_FAILED");
  }
  if (!spreadsheet || typeof spreadsheet.getSheetByName !== "function" ||
      typeof spreadsheet.getSheets !== "function") {
    throw new Error("SPREADSHEET_REPOSITORY_SPREADSHEET_INVALID");
  }

  return Object.freeze({
    readSheet: function(sheetName, options) {
      const normalizedName = String(sheetName || "").trim();
      if (!normalizedName) throw new Error("SPREADSHEET_REPOSITORY_SHEET_NAME_REQUIRED");
      const sheet = spreadsheet.getSheetByName(normalizedName);
      return spreadsheetRepositoryReadSheetSnapshotTest_(sheet, normalizedName, options);
    },
    readAllSheets: function(options) {
      const sheets = spreadsheet.getSheets();
      if (!Array.isArray(sheets)) throw new Error("SPREADSHEET_REPOSITORY_SHEETS_INVALID");
      return sheets.map(function(sheet) {
        if (!sheet || typeof sheet.getName !== "function") {
          throw new Error("SPREADSHEET_REPOSITORY_SHEET_INVALID");
        }
        return spreadsheetRepositoryReadSheetSnapshotTest_(sheet, String(sheet.getName()), options);
      });
    }
  });
}

function createAppsScriptSpreadsheetProviderTest_() {
  return Object.freeze({
    openById: function(spreadsheetId) {
      return SpreadsheetApp.openById(spreadsheetId);
    }
  });
}

function resolveSpreadsheetRepositoryTest_(context) {
  const config = context || {};
  if (spreadsheetRepositoryIsReadableTest_(config)) return config;
  const repository = config.spreadsheet_repository || config.repository || null;
  if (spreadsheetRepositoryIsReadableTest_(repository)) return repository;
  if (repository) throw new Error("SPREADSHEET_REPOSITORY_INVALID");
  if (config.spreadsheet_id || config.provider) {
    return createSpreadsheetRepositoryTest_({
      spreadsheet_id: config.spreadsheet_id,
      provider: config.provider
    });
  }
  // The compatibility path is still explicit configuration; it never falls back to an active sheet.
  let configuredSpreadsheetId = "";
  try {
    configuredSpreadsheetId = PropertiesService.getScriptProperties()
      .getProperty(SPREADSHEET_REPOSITORY_TEST_CONFIG.ID_PROPERTY) || "";
  } catch (error) {
    configuredSpreadsheetId = "";
  }
  if (String(configuredSpreadsheetId).trim()) {
    return createSpreadsheetRepositoryTest_({
      spreadsheet_id: configuredSpreadsheetId,
      provider: createAppsScriptSpreadsheetProviderTest_()
    });
  }
  throw new Error("SPREADSHEET_REPOSITORY_CONTEXT_REQUIRED");
}

function spreadsheetRepositoryIsReadableTest_(repository) {
  return !!repository && typeof repository.readSheet === "function" &&
    typeof repository.readAllSheets === "function";
}

function spreadsheetRepositoryReadSheetSnapshotTest_(sheet, sheetName, options) {
  if (!sheet) {
    return {
      exists: false,
      sheet_id: null,
      name: String(sheetName),
      last_row: 0,
      last_column: 0,
      values: []
    };
  }
  if (typeof sheet.getLastRow !== "function" || typeof sheet.getLastColumn !== "function" ||
      typeof sheet.getRange !== "function") {
    throw new Error("SPREADSHEET_REPOSITORY_SHEET_INVALID:" + String(sheetName));
  }

  const config = options || {};
  const valueMode = config.value_mode === SPREADSHEET_REPOSITORY_TEST_CONFIG.VALUE_MODE.RAW
    ? SPREADSHEET_REPOSITORY_TEST_CONFIG.VALUE_MODE.RAW
    : SPREADSHEET_REPOSITORY_TEST_CONFIG.VALUE_MODE.DISPLAY;
  const lastRow = Math.max(0, Number(sheet.getLastRow()) || 0);
  const lastColumn = Math.max(0, Number(sheet.getLastColumn()) || 0);
  const minimumRows = Math.max(0, Number(config.minimum_rows) || 0);
  const requestedColumns = config.column_count == null
    ? lastColumn
    : Math.max(0, Number(config.column_count) || 0);
  const rowCount = Math.max(lastRow, minimumRows);
  let values = [];
  if (config.metadata_only !== true && rowCount > 0 && requestedColumns > 0) {
    const range = sheet.getRange(1, 1, rowCount, requestedColumns);
    if (!range) throw new Error("SPREADSHEET_REPOSITORY_RANGE_INVALID:" + String(sheetName));
    if (valueMode === SPREADSHEET_REPOSITORY_TEST_CONFIG.VALUE_MODE.RAW) {
      if (typeof range.getValues !== "function") {
        throw new Error("SPREADSHEET_REPOSITORY_RAW_READ_UNAVAILABLE:" + String(sheetName));
      }
      values = range.getValues();
    } else {
      if (typeof range.getDisplayValues !== "function") {
        throw new Error("SPREADSHEET_REPOSITORY_DISPLAY_READ_UNAVAILABLE:" + String(sheetName));
      }
      values = range.getDisplayValues();
    }
  }
  if (!Array.isArray(values)) throw new Error("SPREADSHEET_REPOSITORY_VALUES_INVALID:" + String(sheetName));

  return {
    exists: true,
    sheet_id: typeof sheet.getSheetId === "function" ? sheet.getSheetId() : null,
    name: typeof sheet.getName === "function" ? String(sheet.getName()) : String(sheetName),
    last_row: lastRow,
    last_column: lastColumn,
    values: values
  };
}
