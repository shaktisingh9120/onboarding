/************************************************
 * GLOBAL DATA
 ***********************************************/
let sheet1Data = [];
let sheet2Data = [];

/************************************************
 * FILE UPLOADS
 ***********************************************/
document.getElementById("sheet1File").addEventListener("change", e => {
  readExcel(e.target.files[0], data => sheet1Data = data);
});

document.getElementById("sheet2File").addEventListener("change", e => {
  readExcel(e.target.files[0], data => sheet2Data = data);
});

/************************************************
 * READ EXCEL
 ***********************************************/
function readExcel(file, callback) {
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    let raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const header = raw[0];
    const rows = raw.slice(1).filter(r => r && r.some(c => c !== "" && c !== undefined));
    callback([header, ...rows]);
  };
  reader.readAsArrayBuffer(file);
}

/************************************************
 * COMPARE (EXACT + CASE SENSITIVE)
 ***********************************************/
function compareSheets() {
  if (!sheet1Data.length || !sheet2Data.length) {
    alert("Upload both files first");
    return;
  }

  if (!sheet1Data[0].includes("Updated Cost")) {
    sheet1Data[0].push("Updated Cost");
  }
  const updatedIndex = sheet1Data[0].indexOf("Updated Cost");

  sheet1Data.slice(1).forEach(r => r._updated = r._same = r._unmatched = false);

  const sheet2Map = new Map();
  sheet2Data.slice(1).forEach(r => {
    if (r[0] && r[1]) sheet2Map.set(r[0], { price: r[1], matched: false });
  });

  sheet1Data.slice(1).forEach(row => {
    const testName = row[1];
    const oldPrice = row[4];
    row._unmatched = true;

    if (!sheet2Map.has(testName)) return;

    const match = sheet2Map.get(testName);
    row._unmatched = false;
    row[updatedIndex] = match.price;
    match.matched = true;

    Number(oldPrice) === Number(match.price)
      ? row._same = true
      : row._updated = true;
  });

  updateDashboard();
  renderSheet1("all");
  renderSheet2(sheet2Map);
}

/************************************************
 * DASHBOARD
 ***********************************************/
function updateDashboard() {
  let total = sheet1Data.length - 1;
  let updated = 0, same = 0, unmatched = 0;

  sheet1Data.slice(1).forEach(r => {
    if (r._updated) updated++;
    else if (r._same) same++;
    else if (r._unmatched) unmatched++;
  });

  totalCount.innerText = total;
  updatedCount.innerText = updated;
  sameCount.innerText = same;
  unmatchedCount.innerText = unmatched;
}

/************************************************
 * RENDER TABLES
 ***********************************************/
function renderSheet1(filter) {
  let html = "<table><tr>";
  sheet1Data[0].forEach(h => html += `<th>${h}</th>`);
  html += "</tr>";

  sheet1Data.slice(1).forEach(r => {
    if (
      filter === "updated" && !r._updated ||
      filter === "same" && !r._same ||
      filter === "unmatched" && !r._unmatched
    ) return;

    let cls = r._updated ? "updated" : r._same ? "same" : "";
    html += `<tr class="${cls}">${r.map(c => `<td>${c ?? ""}</td>`).join("")}</tr>`;
  });

  html += "</table>";
  sheet1Table.innerHTML = html;
}

function renderSheet2(map) {
  let html = "<table><tr><th>Test Name</th><th>Price</th></tr>";
  const matched = [...map].filter(([_, v]) => v.matched);

  if (!matched.length) html += `<tr><td colspan="2">No matched tests</td></tr>`;

  matched.forEach(([n, v]) => {
    html += `<tr class="matched"><td>${n}</td><td>${v.price}</td></tr>`;
  });

  html += "</table>";
  sheet2Table.innerHTML = html;
}

/************************************************
 * FILTER
 ***********************************************/
function applyFilter(v) {
  renderSheet1(v);
}

/************************************************
 * EXPORTS
 ***********************************************/
function exportUpdated() {
  exportByFlag("_updated", "Updated_Prices.xlsx");
}

function exportSame() {
  exportByFlag("_same", "Same_Prices.xlsx");
}

function exportUnmatched() {
  exportByFlag("_unmatched", "Unmatched_Tests.xlsx");
}

function exportByFlag(flag, file) {
  const out = [sheet1Data[0]];
  sheet1Data.slice(1).forEach(r => r[flag] && out.push(r));

  if (out.length === 1) return alert("No data to export");

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(out);
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, file);
}
