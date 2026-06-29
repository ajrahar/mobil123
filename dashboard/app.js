const { useEffect, useMemo, useState } = React;
const h = React.createElement;

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("id-ID");
const COLORS = ["#2563eb", "#dc2626", "#059669", "#f59e0b", "#7c3aed", "#0891b2", "#be123c"];
const routes = [
  ["landing", "Landing"],
  ["dashboard", "Dashboard"],
  ["raw", "Raw Data"],
  ["clean", "Clean Data"],
  ["processing", "Processing"],
  ["eda", "EDA"],
  ["correlation", "Korelasi"],
  ["conclusion", "Kesimpulan"],
];
const defaultFilters = { merk: "", lokasi: "", transmisi: "", jenis_mobil: "", minYear: "", maxPrice: "" };

function compactPrice(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} M`;
  return `${Math.round(value / 1_000_000)} jt`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function groupCount(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const value = row[key] || "Tidak diketahui";
    map.set(value, (map.get(value) || 0) + 1);
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function averageBy(rows, key, valueKey = "harga") {
  const map = new Map();
  rows.forEach((row) => {
    if (!Number.isFinite(row[valueKey])) return;
    const label = row[key] || "Tidak diketahui";
    const current = map.get(label) || { label, total: 0, count: 0 };
    current.total += row[valueKey];
    current.count += 1;
    map.set(label, current);
  });
  return [...map.values()].map((item) => ({ label: item.label, value: item.total / item.count, count: item.count })).sort((a, b) => b.value - a.value);
}

function histogram(rows, key, bins = 10, labeler = compactPrice) {
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / bins || 1;
  return Array.from({ length: bins }, (_, index) => {
    const start = min + index * width;
    const end = index === bins - 1 ? max : start + width;
    const value = values.filter((item) => item >= start && (index === bins - 1 ? item <= end : item < end)).length;
    return { label: `${labeler(start)}-${labeler(end)}`, value };
  });
}

function correlation(rows, columns) {
  return columns.map((a) =>
    columns.map((b) => {
      const pairs = rows.map((row) => [row[a], row[b]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (pairs.length < 2) return null;
      const xs = pairs.map(([x]) => x);
      const ys = pairs.map(([, y]) => y);
      const avgX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
      const avgY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
      const numerator = pairs.reduce((sum, [x, y]) => sum + (x - avgX) * (y - avgY), 0);
      const denX = Math.sqrt(xs.reduce((sum, x) => sum + (x - avgX) ** 2, 0));
      const denY = Math.sqrt(ys.reduce((sum, y) => sum + (y - avgY) ** 2, 0));
      return denX && denY ? numerator / (denX * denY) : null;
    })
  );
}

function currentHash() {
  const hash = window.location.hash.replace("#/", "");
  return routes.some(([key]) => key === hash) ? hash : "landing";
}

function Card({ title, children, className = "" }) {
  return h("section", { className: `card ${className}` }, title ? h("h2", null, title) : null, children);
}

function Stat({ label, value, hint }) {
  return h("div", { className: "stat" }, h("span", null, label), h("strong", null, value), h("small", null, hint));
}

function BarChart({ data, valueFormat = number.format, color = COLORS[0] }) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return h("div", { className: "bars" }, data.map((item) =>
    h("div", { className: "bar-row", key: item.label },
      h("span", { className: "bar-label", title: item.label }, item.label),
      h("div", { className: "bar-track" }, h("div", { className: "bar-fill", style: { width: `${(item.value / max) * 100}%`, background: color } })),
      h("span", { className: "bar-value" }, valueFormat(item.value, item))
    )
  ));
}

function Histogram({ data, color = COLORS[1] }) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return h("div", { className: "histogram" }, data.map((item, index) =>
    h("div", { className: "hist-col", key: index, title: `${item.label}: ${item.value}` },
      h("div", { className: "hist-bar", style: { height: `${Math.max(4, (item.value / max) * 100)}%`, background: color } }),
      h("span", null, item.label)
    )
  ));
}

function ScatterPlot({ rows, xKey, yKey, xLabel, yLabel, color = COLORS[2] }) {
  const points = rows.filter((row) => Number.isFinite(row[xKey]) && Number.isFinite(row[yKey]));
  const width = 620;
  const height = 300;
  const pad = 42;
  if (!points.length) return h("div", { className: "empty" }, "Tidak ada data untuk grafik ini.");
  const xMin = Math.min(...points.map((row) => row[xKey]));
  const xMax = Math.max(...points.map((row) => row[xKey]));
  const yMin = Math.min(...points.map((row) => row[yKey]));
  const yMax = Math.max(...points.map((row) => row[yKey]));
  const sx = (value) => pad + ((value - xMin) / ((xMax - xMin) || 1)) * (width - pad * 1.4);
  const sy = (value) => height - pad - ((value - yMin) / ((yMax - yMin) || 1)) * (height - pad * 1.4);

  return h("svg", { className: "scatter", viewBox: `0 0 ${width} ${height}`, role: "img" },
    h("line", { x1: pad, y1: height - pad, x2: width - 16, y2: height - pad }),
    h("line", { x1: pad, y1: 14, x2: pad, y2: height - pad }),
    h("text", { x: width / 2, y: height - 8, textAnchor: "middle" }, xLabel),
    h("text", { x: 15, y: height / 2, transform: `rotate(-90 15 ${height / 2})`, textAnchor: "middle" }, yLabel),
    points.slice(0, 900).map((row, index) => h("circle", { key: index, cx: sx(row[xKey]), cy: sy(row[yKey]), r: 3, fill: color, opacity: 0.48 }))
  );
}

function BoxPlot({ rows, groupKey }) {
  const groups = groupCount(rows, groupKey).slice(0, 8).map((group) => {
    const values = rows.filter((row) => (row[groupKey] || "Tidak diketahui") === group.label).map((row) => row.harga).filter(Number.isFinite);
    return { label: group.label, count: values.length, min: Math.min(...values), q1: quantile(values, 0.25), med: median(values), q3: quantile(values, 0.75), max: Math.max(...values) };
  }).filter((group) => group.count);
  const max = Math.max(1, ...groups.map((group) => group.max));
  return h("div", { className: "boxplot" }, groups.map((group) =>
    h("div", { className: "box-row", key: group.label },
      h("span", { className: "box-label" }, group.label),
      h("div", { className: "box-track" },
        h("div", { className: "box-line", style: { left: `${(group.min / max) * 100}%`, width: `${((group.max - group.min) / max) * 100}%` } }),
        h("div", { className: "box-rect", style: { left: `${(group.q1 / max) * 100}%`, width: `${((group.q3 - group.q1) / max) * 100}%` } }),
        h("div", { className: "box-med", style: { left: `${(group.med / max) * 100}%` } })
      ),
      h("span", { className: "box-value" }, compactPrice(group.med))
    )
  ));
}

function Heatmap({ rows }) {
  const columns = ["tahun", "km", "harga", "is_suv", "is_mpv", "is_sedan", "is_hatchback"].filter((column) => rows.some((row) => Number.isFinite(row[column])));
  const matrix = correlation(rows, columns);
  return h("div", { className: "heatmap", style: { gridTemplateColumns: `110px repeat(${columns.length}, minmax(54px, 1fr))` } },
    h("span", null, ""),
    columns.map((column) => h("b", { key: `h-${column}` }, column)),
    columns.flatMap((rowName, rowIndex) => [
      h("b", { key: `r-${rowName}` }, rowName),
      ...columns.map((column, columnIndex) => {
        const value = matrix[rowIndex][columnIndex];
        const color = value === null ? "#e5e7eb" : value >= 0 ? `rgba(37, 99, 235, ${Math.abs(value)})` : `rgba(220, 38, 38, ${Math.abs(value)})`;
        return h("span", { key: `${rowName}-${column}`, className: "heat-cell", style: { background: color } }, value === null ? "-" : value.toFixed(2));
      }),
    ])
  );
}

function DataTable({ rows, columns, limit = 120 }) {
  return h("div", { className: "table-wrap" },
    h("table", null,
      h("thead", null, h("tr", null, columns.map((column) => h("th", { key: column }, column)))),
      h("tbody", null, rows.slice(0, limit).map((row, index) =>
        h("tr", { key: index }, columns.map((column) => {
          const value = row[column];
          const text = column === "harga" && Number.isFinite(value) ? rupiah.format(value) : column === "km" && Number.isFinite(value) ? number.format(value) : value ?? "-";
          return h("td", { key: column }, text);
        }))
      ))
    )
  );
}

function Controls({ filters, setFilters, options }) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return h("section", { className: "controls" },
    h("select", { value: filters.merk, onChange: (event) => update("merk", event.target.value) }, h("option", { value: "" }, "Semua merk"), options.merk.map((item) => h("option", { key: item, value: item }, item))),
    h("select", { value: filters.lokasi, onChange: (event) => update("lokasi", event.target.value) }, h("option", { value: "" }, "Semua lokasi"), options.lokasi.map((item) => h("option", { key: item, value: item }, item))),
    h("select", { value: filters.transmisi, onChange: (event) => update("transmisi", event.target.value) }, h("option", { value: "" }, "Semua transmisi"), options.transmisi.map((item) => h("option", { key: item, value: item }, item))),
    h("select", { value: filters.jenis_mobil, onChange: (event) => update("jenis_mobil", event.target.value) }, h("option", { value: "" }, "Semua jenis"), options.jenis_mobil.map((item) => h("option", { key: item, value: item }, item))),
    h("label", null, "Tahun min", h("input", { type: "number", value: filters.minYear, onChange: (event) => update("minYear", event.target.value), min: 1990, max: 2026 })),
    h("label", null, "Harga max", h("input", { type: "number", value: filters.maxPrice, onChange: (event) => update("maxPrice", event.target.value), placeholder: "Rp" })),
    h("button", { onClick: () => setFilters(defaultFilters) }, "Reset")
  );
}

function LandingPage({ cleanRows, rawRows, pricedRows }) {
  return h("section", { className: "landing" },
    h("div", { className: "hero-copy" },
      h("p", null, "React Data Story"),
      h("h1", null, "Mobil123 Used Car Analytics"),
      h("span", null, "Aplikasi ini memuat data mentah, hasil processing, eksplorasi visual, korelasi, dashboard interaktif, dan ringkasan insight dari listing mobil bekas.")
    ),
    h("div", { className: "hero-actions" },
      h("a", { href: "#/dashboard" }, "Buka Dashboard"),
      h("a", { href: "#/processing" }, "Lihat Processing")
    ),
    h("div", { className: "stats-grid hero-stats" },
      h(Stat, { label: "Raw rows", value: number.format(rawRows.length), hint: "data awal scraping" }),
      h(Stat, { label: "Clean rows", value: number.format(cleanRows.length), hint: "setelah pembersihan" }),
      h(Stat, { label: "Ada harga", value: number.format(pricedRows.length), hint: "siap analisis harga" }),
      h(Stat, { label: "Jumlah merk", value: number.format(new Set(cleanRows.map((row) => row.merk).filter(Boolean)).size), hint: "kategori brand" })
    )
  );
}

function DashboardPage({ rows, filtered, priced, filters, setFilters, options }) {
  const prices = priced.map((row) => row.harga);
  const avgPrice = prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null;
  return h(React.Fragment, null,
    h(Controls, { filters, setFilters, options }),
    h("section", { className: "stats-grid" },
      h(Stat, { label: "Listing tampil", value: number.format(filtered.length), hint: `${number.format(rows.length)} total bersih` }),
      h(Stat, { label: "Listing ada harga", value: number.format(priced.length), hint: `${Math.round((priced.length / Math.max(filtered.length, 1)) * 100)}% dari filter` }),
      h(Stat, { label: "Harga median", value: compactPrice(median(prices)), hint: "listing berharga" }),
      h(Stat, { label: "Harga rata-rata", value: compactPrice(avgPrice), hint: "sensitif outlier" })
    ),
    h("section", { className: "grid two" },
      h(Card, { title: "Distribusi Harga" }, h(Histogram, { data: histogram(priced, "harga", 12), color: COLORS[1] })),
      h(Card, { title: "Distribusi Kilometer" }, h(Histogram, { data: histogram(filtered, "km", 12, (v) => `${Math.round(v / 1000)}K`), color: COLORS[5] }))
    ),
    h("section", { className: "grid three" },
      h(Card, { title: "Top Merk" }, h(BarChart, { data: groupCount(filtered, "merk").slice(0, 12), color: COLORS[0] })),
      h(Card, { title: "Lokasi Terbanyak" }, h(BarChart, { data: groupCount(filtered, "lokasi").slice(0, 12), color: COLORS[2] })),
      h(Card, { title: "Harga Rata-rata per Merk" }, h(BarChart, { data: averageBy(priced, "merk").slice(0, 12), color: COLORS[3], valueFormat: (value) => compactPrice(value) }))
    ),
    h("section", { className: "grid two" },
      h(Card, { title: "Tahun vs Harga" }, h(ScatterPlot, { rows: priced, xKey: "tahun", yKey: "harga", xLabel: "Tahun", yLabel: "Harga", color: COLORS[4] })),
      h(Card, { title: "KM vs Harga" }, h(ScatterPlot, { rows: priced, xKey: "km", yKey: "harga", xLabel: "Kilometer", yLabel: "Harga", color: COLORS[2] }))
    )
  );
}

function RawPage({ rawRows }) {
  return h(React.Fragment, null,
    h("section", { className: "stats-grid" },
      h(Stat, { label: "Total baris raw", value: number.format(rawRows.length), hint: "termasuk baris kosong" }),
      h(Stat, { label: "Kolom raw", value: "8", hint: "hasil scraping awal" }),
      h(Stat, { label: "Harga terisi", value: number.format(rawRows.filter((row) => row.listing__price).length), hint: "kolom listing__price" }),
      h(Stat, { label: "Model terisi", value: number.format(rawRows.filter((row) => row["listing__rating-model"]).length), hint: "kolom model mentah" })
    ),
    h(Card, { title: "Raw Data Preview", className: "table-card" }, h(DataTable, { rows: rawRows, columns: Object.keys(rawRows[0] || {}), limit: 180 }))
  );
}

function CleanPage({ rows }) {
  return h(React.Fragment, null,
    h("section", { className: "stats-grid" },
      h(Stat, { label: "Clean rows", value: number.format(rows.length), hint: "baris kosong dibuang" }),
      h(Stat, { label: "Harga kosong", value: number.format(rows.filter((row) => !Number.isFinite(row.harga)).length), hint: "tetap dipertahankan" }),
      h(Stat, { label: "Tahun median", value: number.format(median(rows.map((row) => row.tahun).filter(Number.isFinite))), hint: "seluruh clean data" }),
      h(Stat, { label: "KM median", value: number.format(median(rows.map((row) => row.km).filter(Number.isFinite))), hint: "midpoint rentang KM" })
    ),
    h(Card, { title: "Clean Data", className: "table-card" }, h(DataTable, { rows, columns: ["tahun", "merk", "tipe", "jenis_mobil", "transmisi", "km", "lokasi", "penjual", "harga"], limit: 220 }))
  );
}

function ProcessingPage() {
  const steps = [
    ["Load", "Membaca mobil123_raw.csv lalu membuang baris yang seluruh kolomnya kosong."],
    ["Ekstraksi", "Mengambil tahun dari ellipsize, memecah merk dan tipe dari listing__rating-model, lalu fallback ke ellipsize jika model kosong."],
    ["Normalisasi", "Mengubah teks kilometer seperti 40 - 45K KM menjadi angka midpoint dan harga Rupiah menjadi integer."],
    ["Feature", "Membuat kolom jenis_mobil serta dummy is_suv, is_mpv, is_sedan, dan jenis lain yang muncul."],
    ["Export", "Menyimpan raw JSON, clean JSON, clean CSV, metadata, dan parquet untuk pemakaian ulang."]
  ];
  return h("section", { className: "process-list" }, steps.map(([title, body], index) =>
    h(Card, { title: `${index + 1}. ${title}`, key: title }, h("p", null, body))
  ));
}

function EdaPage({ rows, priced }) {
  return h(React.Fragment, null,
    h("section", { className: "grid two" },
      h(Card, { title: "Distribusi Harga" }, h(Histogram, { data: histogram(priced, "harga", 12), color: COLORS[1] })),
      h(Card, { title: "Distribusi Tahun" }, h(Histogram, { data: histogram(rows, "tahun", 12, (v) => `${Math.round(v)}`), color: COLORS[0] }))
    ),
    h("section", { className: "grid three" },
      h(Card, { title: "Jenis Mobil" }, h(BarChart, { data: groupCount(rows, "jenis_mobil").slice(0, 12), color: COLORS[5] })),
      h(Card, { title: "Transmisi" }, h(BarChart, { data: groupCount(rows, "transmisi"), color: COLORS[4] })),
      h(Card, { title: "Penjual" }, h(BarChart, { data: groupCount(rows, "penjual"), color: COLORS[2] }))
    ),
    h("section", { className: "grid two" },
      h(Card, { title: "Sebaran Harga per Transmisi" }, h(BoxPlot, { rows: priced, groupKey: "transmisi" })),
      h(Card, { title: "Sebaran Harga per Penjual" }, h(BoxPlot, { rows: priced, groupKey: "penjual" }))
    )
  );
}

function CorrelationPage({ priced }) {
  return h(React.Fragment, null,
    h("section", { className: "grid two" },
      h(Card, { title: "Heatmap Korelasi" }, h(Heatmap, { rows: priced })),
      h(Card, { title: "Catatan Korelasi" },
        h("ul", { className: "notes" },
          h("li", null, "Korelasi positif berarti dua variabel cenderung naik bersama."),
          h("li", null, "Korelasi negatif berarti ketika satu variabel naik, variabel lain cenderung turun."),
          h("li", null, "Korelasi tidak membuktikan sebab-akibat; ini dipakai sebagai petunjuk awal sebelum modeling.")
        )
      )
    ),
    h("section", { className: "grid two" },
      h(Card, { title: "Tahun vs Harga" }, h(ScatterPlot, { rows: priced, xKey: "tahun", yKey: "harga", xLabel: "Tahun", yLabel: "Harga", color: COLORS[4] })),
      h(Card, { title: "KM vs Harga" }, h(ScatterPlot, { rows: priced, xKey: "km", yKey: "harga", xLabel: "Kilometer", yLabel: "Harga", color: COLORS[2] }))
    )
  );
}

function ConclusionPage({ rows, priced }) {
  const topBrand = groupCount(rows, "merk")[0];
  const topLocation = groupCount(rows, "lokasi")[0];
  const medPrice = compactPrice(median(priced.map((row) => row.harga)));
  return h("section", { className: "conclusion" },
    h(Card, { title: "Kesimpulan Utama" },
      h("ul", { className: "notes" },
        h("li", null, `Dataset bersih berisi ${number.format(rows.length)} listing, dengan ${number.format(priced.length)} listing memiliki harga.`),
        h("li", null, `Merk paling sering muncul adalah ${topBrand?.label || "-"} dan lokasi terbanyak adalah ${topLocation?.label || "-"}.`),
        h("li", null, `Median harga listing yang tersedia berada di kisaran ${medPrice}.`),
        h("li", null, "Tahun kendaraan, kilometer, merk, jenis mobil, transmisi, lokasi, dan tipe penjual layak dipakai sebagai variabel analisis harga.")
      )
    ),
    h(Card, { title: "Arahan Lanjutan" },
      h("p", null, "Untuk analisis prediktif, data yang harga kosong bisa dipisahkan dari training set. Transformasi log harga juga relevan karena harga mobil biasanya condong ke kanan dan memiliki outlier.")
    )
  );
}

function Header({ page }) {
  return h(React.Fragment, null,
    h("header", { className: "topbar" },
      h("div", null, h("p", null, "Mobil123 Used Car Analytics"), h("h1", null, routes.find(([key]) => key === page)?.[1] || "Dashboard")),
      h("a", { href: "../data/mobil123_clean.json", target: "_blank" }, "Buka JSON")
    ),
    h("nav", { className: "tabs" }, routes.map(([key, label]) => h("a", { key, href: `#/${key}`, className: page === key ? "active" : "" }, label)))
  );
}

function App() {
  const [rows, setRows] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [page, setPage] = useState(currentHash());
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(defaultFilters);

  useEffect(() => {
    const onHash = () => setPage(currentHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("../data/mobil123_clean.json").then((response) => response.json()),
      fetch("../data/mobil123_raw.json").then((response) => response.json()),
    ])
      .then(([clean, raw]) => {
        setRows(clean);
        setRawRows(raw);
      })
      .catch((err) => setError(`Gagal load data: ${err.message}`));
  }, []);

  const options = useMemo(() => {
    const unique = (key) => [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort();
    return { merk: unique("merk"), lokasi: unique("lokasi"), transmisi: unique("transmisi"), jenis_mobil: unique("jenis_mobil") };
  }, [rows]);

  const filtered = useMemo(() => rows.filter((row) => {
    if (filters.merk && row.merk !== filters.merk) return false;
    if (filters.lokasi && row.lokasi !== filters.lokasi) return false;
    if (filters.transmisi && row.transmisi !== filters.transmisi) return false;
    if (filters.jenis_mobil && row.jenis_mobil !== filters.jenis_mobil) return false;
    if (filters.minYear && Number(row.tahun) < Number(filters.minYear)) return false;
    if (filters.maxPrice && Number.isFinite(row.harga) && row.harga > Number(filters.maxPrice)) return false;
    return true;
  }), [rows, filters]);
  const priced = filtered.filter((row) => Number.isFinite(row.harga));
  const allPriced = rows.filter((row) => Number.isFinite(row.harga));

  if (error) return h("main", { className: "app" }, h("div", { className: "error" }, error));
  if (!rows.length || !rawRows.length) return h("main", { className: "app" }, h("div", { className: "loading" }, "Memuat data..."));

  const pageNode = {
    landing: h(LandingPage, { cleanRows: rows, rawRows, pricedRows: allPriced }),
    dashboard: h(DashboardPage, { rows, filtered, priced, filters, setFilters, options }),
    raw: h(RawPage, { rawRows }),
    clean: h(CleanPage, { rows }),
    processing: h(ProcessingPage),
    eda: h(EdaPage, { rows, priced: allPriced }),
    correlation: h(CorrelationPage, { priced: allPriced }),
    conclusion: h(ConclusionPage, { rows, priced: allPriced }),
  }[page];

  return h("main", { className: "app" }, h(Header, { page }), pageNode);
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
