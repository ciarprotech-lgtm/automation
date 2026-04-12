const axios = require("axios");
const fs = require("fs");
const path = require("path");

const combinedFile = (() => {
  const primary = path.join(__dirname, "Combined.csv");
  const fallback = path.join(__dirname, "Combined_stocks.csv");
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
})();
const stocksJsonFile = path.join(__dirname, "stocks.json");
const stocksCsvFile = path.join(__dirname, "stocks_output.csv");
const finalJsonFile = path.join(__dirname, "final_stocks.json");
const finalCsvFile = path.join(__dirname, "final_stocks.csv");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseCsv = (text) => {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 0);
};

const formatCsvRow = (row) =>
  row
    .map((value) => {
      const text = value == null ? "" : String(value);
      if (text.includes(",") || text.includes('"') || text.includes("\n")) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    })
    .join(",");

const saveCsv = (filePath, rows) => {
  fs.writeFileSync(filePath, rows.map(formatCsvRow).join("\n"), "utf-8");
};

const loadCombinedSymbols = () => {
  if (!fs.existsSync(combinedFile)) {
    throw new Error(`Missing input file: ${combinedFile}`);
  }

  const text = fs.readFileSync(combinedFile, "utf-8");
  const rows = parseCsv(text);

  if (rows.length === 0) {
    return [];
  }

  return rows
    .slice(1)
    .map((row) => (row[0] || "").replace(/"/g, "").trim())
    .filter(Boolean);
};

const fetchStock = async (symbol) => {
  const encoded = encodeURIComponent(symbol);
  const url = `https://platform-ecosystem.api.tickertape.in/search?text=${encoded}&types=stock`;

  try {
    const res = await axios.get(url);
    const items = Array.isArray(res.data?.data) ? res.data.data : [];

    return items.find(
      (item) =>
        item.type === "stock" &&
        item.ticker?.toString().toUpperCase() === symbol.toString().toUpperCase()
    );
  } catch (error) {
    console.error(`Search request failed for ${symbol}:`, error.message || error);
    return null;
  }
};

const saveSearchResults = (results) => {
  fs.writeFileSync(stocksJsonFile, JSON.stringify(results, null, 2), "utf-8");
  saveCsv(
    stocksCsvFile,
    [["name", "symbol", "sid"], ...results.map((item) => [item.name, item.symbol, item.sid])]
  );
};

const runFirstProcess = async () => {
  console.log(`First process: reading symbols from ${combinedFile}`);
  const symbols = loadCombinedSymbols();
  const results = [];

  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index];
    console.log(`Searching ${index + 1}/${symbols.length}: ${symbol}`);

    const stock = await fetchStock(symbol);

    if (stock) {
      results.push({ name: stock.name, symbol: stock.ticker, sid: stock.sid });
      console.log(`✅ Found ${symbol} => ${stock.ticker} (${stock.sid})`);
    } else {
      console.log(`❌ Not found: ${symbol}`);
    }

    saveSearchResults(results);
    await delay(2000);
  }

  console.log(`First process complete. ${results.length} records saved to ${stocksCsvFile}`);
};

const loadStockSids = () => {
  if (!fs.existsSync(stocksCsvFile)) {
    throw new Error(`Missing stock output file: ${stocksCsvFile}`);
  }

  const text = fs.readFileSync(stocksCsvFile, "utf-8");
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return [];
  }

  const header = rows[0].map((cell) => String(cell).trim().toLowerCase());
  const sidIndex = header.indexOf("sid");
  const nameIndex = header.indexOf("name");
  const symbolIndex = header.indexOf("symbol");

  if (sidIndex === -1) {
    throw new Error(`stocks_output.csv must contain sid header`);
  }

  return rows.slice(1).map((row) => ({
    name: nameIndex !== -1 ? (row[nameIndex] || "").trim() : "",
    symbol: symbolIndex !== -1 ? (row[symbolIndex] || "").trim() : "",
    sid: (row[sidIndex] || "").trim(),
  })).filter((item) => item.sid);
};

const fetchStockInfo = async (sid) => {
  const url = `https://api.tickertape.in/stocks/info/${encodeURIComponent(sid)}`;

  try {
    const res = await axios.get(url);
    const result = res.data;
    if (!result?.success || !result.data) {
      console.warn(`Info request returned no data for SID ${sid}`);
      return null;
    }

    const data = result.data;
    const marketCapTitle = data.labels?.marketCap?.title || "";
    const gic = data.gic || {};

    return {
      sid,
      sector: gic.sector || "",
      industrygroup: gic.industrygroup || "",
      industry: gic.industry || "",
      subindustry: gic.subindustry || "",
      marketCapTitle,
    };
  } catch (error) {
    console.error(`Info request failed for SID ${sid}:`, error.message || error);
    return null;
  }
};

const saveFinalResults = (results) => {
  fs.writeFileSync(finalJsonFile, JSON.stringify(results, null, 2), "utf-8");
  saveCsv(
    finalCsvFile,
    [
      ["name", "symbol", "sid", "sector", "industrygroup", "industry", "subindustry", "marketCapTitle"],
      ...results.map((item) => [
        item.name,
        item.symbol,
        item.sid,
        item.sector,
        item.industrygroup,
        item.industry,
        item.subindustry,
        item.marketCapTitle,
      ]),
    ]
  );
};

const runSecondProcess = async () => {
  console.log(`Second process: reading SIDs from ${stocksCsvFile}`);
  const sids = loadStockSids();
  const results = [];

  for (let index = 0; index < sids.length; index += 1) {
    const stock = sids[index];
    console.log(`Fetching info ${index + 1}/${sids.length}: ${stock.sid}`);

    const info = await fetchStockInfo(stock.sid);
    if (info) {
      results.push({
        name: stock.name,
        symbol: stock.symbol,
        ...info,
      });
      console.log(`✅ Saved info for ${stock.sid}`);
    } else {
      console.log(`❌ No info for ${stock.sid}`);
    }

    saveFinalResults(results);
    await delay(7000);
  }

  console.log(`Second process complete. ${results.length} records saved to ${finalCsvFile}`);
};

(async () => {
  try {
    await runFirstProcess();
    await runSecondProcess();
    console.log("🎉 All processes finished.");
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
})();