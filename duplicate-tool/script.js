let sourceRows = [];
let justifiedData = [];
let duplicateRowFlags = [];
let duplicateCount = 0; // <-- GLOBAL so dashboard can access

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("fileInput").addEventListener("change", handleFile);
  document.getElementById("downloadJustifiedBtn").addEventListener("click", downloadJustified);
  document.getElementById("downloadSourceBtn").addEventListener("click", downloadSource);
  document.getElementById("downloadRedBtn").addEventListener("click", downloadRed);
});

/* ================= FILE UPLOAD ================= */

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = evt => {
    const wb = XLSX.read(evt.target.result, { type: "binary" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    sourceRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    processData();
  };

  reader.readAsBinaryString(file);
}

/* ================= PROCESS DATA ================= */

function processData() {
  const sheet1 = document.getElementById("sheet1Table");
  const unique = document.getElementById("uniqueTable");

  sheet1.innerHTML = "";
  unique.innerHTML = "";
  duplicateRowFlags = [];
  duplicateCount = 0;

  justifiedData = [["Test ID", "Test Name", "Occurrence Count"]];

  /* Render Source Sheet */
  sourceRows.forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const td = document.createElement("td");
      td.textContent = cell ?? "";
      tr.appendChild(td);
    });
    sheet1.appendChild(tr);
  });

  /* Duplicate Detection (Test Name only) */
  const map = new Map();

  for (let i = 1; i < sourceRows.length; i++) {
    const testName = sourceRows[i][1];
    if (!testName) continue;

    const key = testName.trim().toUpperCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  }

  /* Unique Table Header */
  unique.innerHTML = `
    <tr>
      <th>Test ID</th>
      <th>Test Name</th>
      <th>Occurrence Count</th>
    </tr>
  `;

  /* Process Duplicates */
  map.forEach(rows => {
    if (rows.length > 1) {
      const first = sourceRows[rows[0]];

      justifiedData.push([first[0], first[1], rows.length]);

      unique.innerHTML += `
        <tr>
          <td>${first[0]}</td>
          <td>${first[1]}</td>
          <td>${rows.length}</td>
        </tr>
      `;

      rows.slice(1).forEach(r => {
        sheet1.rows[r].classList.add("justified-row");
        duplicateRowFlags[r] = true;
        duplicateCount++;
      });
    }
  });

  /* ================= DASHBOARD ================= */

  const totalRows = sourceRows.length - 1;

  document.getElementById("dashboard").classList.remove("d-none");
  document.getElementById("filterBox").classList.remove("d-none");

  document.getElementById("totalRows").innerText = totalRows;
  document.getElementById("uniqueTests").innerText = justifiedData.length - 1;
  document.getElementById("duplicateRows").innerText = duplicateCount;

  /* DUPLICATE % (FIXED) */
  const duplicatePercent =
    totalRows > 0 ? ((duplicateCount / totalRows) * 100).toFixed(1) : "0.0";

  document.getElementById("duplicatePercent").innerText = duplicatePercent + "%";

  document.getElementById("downloadJustifiedBtn").classList.remove("d-none");
  document.getElementById("downloadSourceBtn").classList.remove("d-none");
  document.getElementById("downloadRedBtn").classList.remove("d-none");
}

/* ================= FILTER ================= */

function filterRows(mode) {
  const rows = document.querySelectorAll("#sheet1Table tr");

  rows.forEach((tr, i) => {
    if (i === 0) return;
    tr.style.display =
      mode === "dup" ? (duplicateRowFlags[i] ? "" : "none") : "";
  });
}

/* ================= EXPORTS ================= */

function downloadJustified() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(justifiedData);
  XLSX.utils.book_append_sheet(wb, ws, "Justified");
  XLSX.writeFile(wb, "Unique_Tests_Justified.xlsx");
}

function downloadSource() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sourceRows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, "Sheet1.xlsx");
}

function downloadRed() {
  const redRows = [sourceRows[0]];

  duplicateRowFlags.forEach((isDup, i) => {
    if (isDup) redRows.push(sourceRows[i]);
  });

  const ws = XLSX.utils.aoa_to_sheet(redRows);

  /* Red Cell Fill */
  redRows.forEach((_, r) => {
    Object.keys(ws).forEach(cell => {
      if (cell.startsWith("!") || XLSX.utils.decode_cell(cell).r !== r) return;
      ws[cell].s = {
        fill: { fgColor: { rgb: "F8D7DA" } }
      };
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Red_Duplicates");
  XLSX.writeFile(wb, "Red_Duplicate_Tests.xlsx");
}
