import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, ShieldCheck } from "lucide-react";
import { COLORS, defaultFilters, routes } from "./config.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("id-ID");

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
  return [...map.values()]
    .map((item) => ({ label: item.label, value: item.total / item.count, count: item.count }))
    .sort((a, b) => b.value - a.value);
}

function missingSummary(rows, columns) {
  return columns
    .map((column) => ({
      label: column,
      value: rows.filter((row) => row[column] === null || row[column] === undefined || row[column] === "").length,
    }))
    .sort((a, b) => b.value - a.value);
}

function outlierSummary(rows, key = "harga") {
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  const outliers = rows.filter((row) => Number.isFinite(row[key]) && (row[key] < low || row[key] > high));
  return { low, high, outliers };
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

function correlationInsights(rows) {
  const columns = ["tahun", "km", "is_suv", "is_mpv", "is_sedan", "is_hatchback", "is_coupe", "is_pickup"].filter((column) =>
    rows.some((row) => Number.isFinite(row[column]))
  );
  return columns
    .map((column) => {
      const value = correlation(rows, ["harga", column])[0][1];
      return { label: column, value };
    })
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function currentHash() {
  const hash = window.location.hash.replace("#/", "");
  return routes.some(([key]) => key === hash) ? hash : "landing";
}

function SectionCard({ title, children, className = "" }) {
  return (
    <Card className={className}>
      {title ? (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <Card className="stat-card bg-[color:var(--color-surface-lowest)]">
      <CardContent className="space-y-2 p-6">
        <p className="text-sm font-medium text-[color:var(--color-on-surface-muted)]">{label}</p>
        <p className="font-['Manrope',sans-serif] text-4xl leading-none text-[color:var(--color-on-surface)]">{value}</p>
        <p className="text-xs text-[color:var(--color-on-surface-muted)]">{hint}</p>
      </CardContent>
    </Card>
  );
}

function BarChart({ data, valueFormat = number.format, color = COLORS[0], onBarClick }) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="bars">
      {data.map((item) => (
        <button
          className={`bar-row ${onBarClick ? "clickable" : ""}`}
          key={item.label}
          onClick={() => onBarClick?.(item)}
          type="button"
        >
          <span className="bar-label" title={item.label}>
            {item.label}
          </span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%`, background: color }} />
          </div>
          <span className="bar-value">{valueFormat(item.value, item)}</span>
        </button>
      ))}
    </div>
  );
}

function Histogram({ data, color = COLORS[1] }) {
  if (!data.length) return <div className="empty">Tidak ada data untuk histogram.</div>;
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="histogram">
      {data.map((item, index) => (
        <div className="hist-col" key={index} title={`${item.label}: ${item.value}`}>
          <div className="hist-track">
            <div
              className="hist-bar"
              style={{
                height: `${Math.max(8, (Math.sqrt(item.value) / Math.sqrt(max)) * 100)}%`,
                background: color,
              }}
            />
          </div>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function ScatterPlot({ rows, xKey, yKey, xLabel, yLabel, color = COLORS[2] }) {
  const points = rows.filter((row) => Number.isFinite(row[xKey]) && Number.isFinite(row[yKey]));
  const width = 620;
  const height = 300;
  const pad = 42;
  if (!points.length) return <div className="empty">Tidak ada data untuk grafik ini.</div>;

  const xMin = Math.min(...points.map((row) => row[xKey]));
  const xMax = Math.max(...points.map((row) => row[xKey]));
  const yMin = Math.min(...points.map((row) => row[yKey]));
  const yMax = Math.max(...points.map((row) => row[yKey]));
  const sx = (value) => pad + ((value - xMin) / (xMax - xMin || 1)) * (width - pad * 1.4);
  const sy = (value) => height - pad - ((value - yMin) / (yMax - yMin || 1)) * (height - pad * 1.4);

  return (
    <svg className="scatter" viewBox={`0 0 ${width} ${height}`} role="img">
      <line x1={pad} y1={height - pad} x2={width - 16} y2={height - pad} />
      <line x1={pad} y1={14} x2={pad} y2={height - pad} />
      <text x={width / 2} y={height - 8} textAnchor="middle">
        {xLabel}
      </text>
      <text x={15} y={height / 2} transform={`rotate(-90 15 ${height / 2})`} textAnchor="middle">
        {yLabel}
      </text>
      {points.slice(0, 900).map((row, index) => (
        <circle key={index} cx={sx(row[xKey])} cy={sy(row[yKey])} r="3" fill={color} opacity="0.48" />
      ))}
    </svg>
  );
}

function PredictionPlot({ rows }) {
  const points = rows.filter((row) => Number.isFinite(row.actual) && Number.isFinite(row.predicted_log_mlr));
  const width = 620;
  const height = 300;
  const pad = 42;
  if (!points.length) return <div className="empty">Belum ada data evaluasi prediksi.</div>;

  const values = points.flatMap((row) => [row.actual, row.predicted_log_mlr]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scale = (value) => pad + ((value - min) / (max - min || 1)) * (width - pad * 1.4);
  const sy = (value) => height - pad - ((value - min) / (max - min || 1)) * (height - pad * 1.4);

  return (
    <svg className="scatter" viewBox={`0 0 ${width} ${height}`} role="img">
      <line x1={pad} y1={height - pad} x2={width - 16} y2={height - pad} />
      <line x1={pad} y1={14} x2={pad} y2={height - pad} />
      <line className="ideal-line" x1={scale(min)} y1={sy(min)} x2={scale(max)} y2={sy(max)} />
      <text x={width / 2} y={height - 8} textAnchor="middle">
        Harga Aktual
      </text>
      <text x={15} y={height / 2} transform={`rotate(-90 15 ${height / 2})`} textAnchor="middle">
        Harga Prediksi
      </text>
      {points.map((row, index) => (
        <circle key={index} cx={scale(row.actual)} cy={sy(row.predicted_log_mlr)} r="3" fill={COLORS[0]} opacity="0.5" />
      ))}
    </svg>
  );
}

function BoxPlot({ rows, groupKey }) {
  const groups = groupCount(rows, groupKey)
    .slice(0, 8)
    .map((group) => {
      const values = rows
        .filter((row) => (row[groupKey] || "Tidak diketahui") === group.label)
        .map((row) => row.harga)
        .filter(Number.isFinite);
      return {
        label: group.label,
        count: values.length,
        min: Math.min(...values),
        q1: quantile(values, 0.25),
        med: median(values),
        q3: quantile(values, 0.75),
        max: Math.max(...values),
      };
    })
    .filter((group) => group.count);
  const max = Math.max(1, ...groups.map((group) => group.max));

  return (
    <div className="boxplot">
      {groups.map((group) => (
        <div className="box-row" key={group.label}>
          <span className="box-label">{group.label}</span>
          <div className="box-track">
            <div className="box-line" style={{ left: `${(group.min / max) * 100}%`, width: `${((group.max - group.min) / max) * 100}%` }} />
            <div className="box-rect" style={{ left: `${(group.q1 / max) * 100}%`, width: `${((group.q3 - group.q1) / max) * 100}%` }} />
            <div className="box-med" style={{ left: `${(group.med / max) * 100}%` }} />
          </div>
          <span className="box-value">{compactPrice(group.med)}</span>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ rows }) {
  const columns = ["tahun", "km", "harga", "is_suv", "is_mpv", "is_sedan", "is_hatchback"].filter((column) =>
    rows.some((row) => Number.isFinite(row[column]))
  );
  const matrix = correlation(rows, columns);

  return (
    <div className="heatmap" style={{ gridTemplateColumns: `110px repeat(${columns.length}, minmax(54px, 1fr))` }}>
      <span />
      {columns.map((column) => (
        <b key={`h-${column}`}>{column}</b>
      ))}
      {columns.flatMap((rowName, rowIndex) => [
        <b key={`r-${rowName}`}>{rowName}</b>,
        ...columns.map((column, columnIndex) => {
          const value = matrix[rowIndex][columnIndex];
          const color =
            value === null
              ? "#e8e8e8"
              : value >= 0
                ? `rgba(62, 98, 132, ${Math.abs(value)})`
                : `rgba(52, 50, 46, ${Math.abs(value) * 0.68})`;
          return (
            <span key={`${rowName}-${column}`} className="heat-cell" style={{ background: color }}>
              {value === null ? "-" : value.toFixed(2)}
            </span>
          );
        }),
      ])}
    </div>
  );
}

function DataTable({ rows, columns, limit = 120, sortKey, sortDir, onSort }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>
              {onSort ? (
                <button className="th-button" onClick={() => onSort(column)} type="button">
                  {column}
                  {sortKey === column ? ` ${sortDir === "asc" ? "^" : "v"}` : ""}
                </button>
              ) : (
                column
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, limit).map((row, index) => (
          <TableRow key={index}>
            {columns.map((column) => {
              const value = row[column];
              const text =
                column === "harga" && Number.isFinite(value)
                  ? rupiah.format(value)
                  : column === "km" && Number.isFinite(value)
                    ? number.format(value)
                    : value ?? "-";
              return <TableCell key={column}>{text}</TableCell>;
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function FilterSelect({ value, placeholder, options, onChange }) {
  return (
    <Select value={value || "all"} onValueChange={(v) => onChange(v === "all" ? "" : v)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Controls({ filters, setFilters, options }) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <section className="controls-tonal">
      <div>
        <p className="field-label">Cari</p>
        <Input type="search" value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="merk / tipe" />
      </div>
      <FilterSelect value={filters.merk} onChange={(v) => update("merk", v)} placeholder="Semua merk" options={options.merk} />
      <FilterSelect value={filters.lokasi} onChange={(v) => update("lokasi", v)} placeholder="Semua lokasi" options={options.lokasi} />
      <FilterSelect value={filters.transmisi} onChange={(v) => update("transmisi", v)} placeholder="Semua transmisi" options={options.transmisi} />
      <FilterSelect value={filters.jenis_mobil} onChange={(v) => update("jenis_mobil", v)} placeholder="Semua jenis" options={options.jenis_mobil} />

      <div>
        <p className="field-label">Tahun min</p>
        <Input type="number" value={filters.minYear} onChange={(event) => update("minYear", event.target.value)} min={1990} max={2026} />
      </div>
      <div>
        <p className="field-label">Tahun max</p>
        <Input type="number" value={filters.maxYear} onChange={(event) => update("maxYear", event.target.value)} min={1990} max={2026} />
      </div>
      <div>
        <p className="field-label">Harga min</p>
        <Input type="number" value={filters.minPrice} onChange={(event) => update("minPrice", event.target.value)} placeholder="Rp" />
      </div>
      <div>
        <p className="field-label">Harga max</p>
        <Input type="number" value={filters.maxPrice} onChange={(event) => update("maxPrice", event.target.value)} placeholder="Rp" />
      </div>

      <Select
        value={`${filters.sortKey}:${filters.sortDir}`}
        onValueChange={(v) => {
          const [sortKey, sortDir] = v.split(":");
          setFilters((current) => ({ ...current, sortKey, sortDir }));
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="harga:desc">Harga tertinggi</SelectItem>
          <SelectItem value="harga:asc">Harga terendah</SelectItem>
          <SelectItem value="tahun:desc">Tahun terbaru</SelectItem>
          <SelectItem value="tahun:asc">Tahun terlama</SelectItem>
          <SelectItem value="km:asc">KM terendah</SelectItem>
          <SelectItem value="km:desc">KM tertinggi</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="secondary" onClick={() => setFilters(defaultFilters)}>
        Reset
      </Button>
    </section>
  );
}

function LandingPage({ cleanRows, rawRows, pricedRows }) {
  return (
    <section className="landing">
      <div className="hero-shell">
        <div className="hero-copy">
          <Badge>
            <ShieldCheck className="h-3.5 w-3.5" />
            Trust Badge: Safety Certified Data Flow
          </Badge>
          <p className="hero-kicker">Serene Guardian Analytics</p>
          <h1>Mobil123 Used Car Intelligence</h1>
          <span>
            Dashboard ini menyatukan data mentah, data bersih, EDA, korelasi, dan evaluasi regresi linear untuk membantu keputusan yang lebih tenang,
            jelas, dan terukur.
          </span>
          <div className="hero-actions">
            <Button asChild>
              <a href="#/dashboard">Buka Dashboard</a>
            </Button>
            <Button asChild variant="secondary">
              <a href="#/processing">Lihat Processing</a>
            </Button>
          </div>
        </div>
        <div className="hero-preview">
          <Card className="preview-main bg-[color:var(--color-surface)]/60 backdrop-blur-xl">
            <CardContent className="space-y-8 p-7">
              <div className="preview-head">
                <span>Average price</span>
                <strong>246 jt</strong>
              </div>
              <div className="area-chart">
                {[36, 58, 44, 72, 66, 88].map((v, idx) => (
                  <i key={idx} style={{ height: `${v}%` }} />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="preview-side bg-[color:var(--color-surface)]/70 backdrop-blur-xl">
            <CardContent className="grid place-items-center gap-3 p-6">
              <div className="donut">
                <span>74%</span>
              </div>
              <p>priced listings</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Raw rows" value={number.format(rawRows.length)} hint="data awal scraping" />
        <StatCard label="Clean rows" value={number.format(cleanRows.length)} hint="setelah pembersihan" />
        <StatCard label="Ada harga" value={number.format(pricedRows.length)} hint="siap analisis harga" />
        <StatCard
          label="Jumlah merk"
          value={number.format(new Set(cleanRows.map((row) => row.merk).filter(Boolean)).size)}
          hint="kategori brand"
        />
      </div>
    </section>
  );
}

function DashboardPage({ rows, filtered, priced, filters, setFilters, options }) {
  const [tableSearch, setTableSearch] = useState("");
  const prices = priced.map((row) => row.harga);
  const avgPrice = prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null;
  const tableRows = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    if (!query) return filtered;
    const searchableCols = ["tahun", "merk", "tipe", "jenis_mobil", "transmisi", "km", "lokasi", "penjual", "harga"];
    return filtered.filter((row) => searchableCols.some((col) => String(row[col] ?? "").toLowerCase().includes(query)));
  }, [filtered, tableSearch]);

  const sortTable = (column) =>
    setFilters((current) => ({
      ...current,
      sortKey: column,
      sortDir: current.sortKey === column && current.sortDir === "desc" ? "asc" : "desc",
    }));

  return (
    <>
      <Controls filters={filters} setFilters={setFilters} options={options} />
      <section className="stats-grid">
        <StatCard label="Listing tampil" value={number.format(filtered.length)} hint={`${number.format(rows.length)} total bersih`} />
        <StatCard
          label="Listing ada harga"
          value={number.format(priced.length)}
          hint={`${Math.round((priced.length / Math.max(filtered.length, 1)) * 100)}% dari filter`}
        />
        <StatCard label="Harga median" value={compactPrice(median(prices))} hint="listing berharga" />
        <StatCard label="Harga rata-rata" value={compactPrice(avgPrice)} hint="sensitif outlier" />
      </section>

      <section className="grid-two">
        <SectionCard title="Distribusi Harga">
          <Histogram data={histogram(priced, "harga", 12)} color={COLORS[1]} />
        </SectionCard>
        <SectionCard title="Distribusi Kilometer">
          <Histogram data={histogram(filtered, "km", 12, (v) => `${Math.round(v / 1000)}K`)} color={COLORS[5]} />
        </SectionCard>
      </section>

      <section className="grid-three">
        <SectionCard title="Top Merk">
          <BarChart
            data={groupCount(filtered, "merk").slice(0, 12)}
            color={COLORS[0]}
            onBarClick={(item) => setFilters((current) => ({ ...current, merk: item.label === "Tidak diketahui" ? "" : item.label }))}
          />
        </SectionCard>
        <SectionCard title="Lokasi Terbanyak">
          <BarChart
            data={groupCount(filtered, "lokasi").slice(0, 12)}
            color={COLORS[2]}
            onBarClick={(item) => setFilters((current) => ({ ...current, lokasi: item.label === "Tidak diketahui" ? "" : item.label }))}
          />
        </SectionCard>
        <SectionCard title="Harga Rata-rata per Merk">
          <BarChart data={averageBy(priced, "merk").slice(0, 12)} color={COLORS[3]} valueFormat={(value) => compactPrice(value)} />
        </SectionCard>
      </section>

      <section className="grid-two">
        <SectionCard title="Tahun vs Harga">
          <ScatterPlot rows={priced} xKey="tahun" yKey="harga" xLabel="Tahun" yLabel="Harga" color={COLORS[4]} />
        </SectionCard>
        <SectionCard title="KM vs Harga">
          <ScatterPlot rows={priced} xKey="km" yKey="harga" xLabel="Kilometer" yLabel="Harga" color={COLORS[2]} />
        </SectionCard>
      </section>

      <SectionCard title="Filtered Listings" className="table-card">
        <div className="table-search-row">
          <Input
            type="search"
            value={tableSearch}
            onChange={(event) => setTableSearch(event.target.value)}
            placeholder="Cari cepat di tabel: merk, tipe, lokasi, harga..."
          />
          <p>
            Menampilkan {number.format(Math.min(tableRows.length, 160))} dari {number.format(tableRows.length)} baris hasil pencarian.
          </p>
        </div>
        <DataTable
          rows={tableRows}
          columns={["tahun", "merk", "tipe", "jenis_mobil", "transmisi", "km", "lokasi", "penjual", "harga"]}
          limit={160}
          sortKey={filters.sortKey}
          sortDir={filters.sortDir}
          onSort={sortTable}
        />
      </SectionCard>
    </>
  );
}

function RawPage({ rawRows }) {
  return (
    <>
      <section className="stats-grid">
        <StatCard label="Total baris raw" value={number.format(rawRows.length)} hint="termasuk baris kosong" />
        <StatCard label="Kolom raw" value="8" hint="hasil scraping awal" />
        <StatCard label="Harga terisi" value={number.format(rawRows.filter((row) => row.listing__price).length)} hint="kolom listing__price" />
        <StatCard
          label="Model terisi"
          value={number.format(rawRows.filter((row) => row["listing__rating-model"]).length)}
          hint="kolom model mentah"
        />
      </section>
      <SectionCard title="Raw Data Preview" className="table-card">
        <DataTable rows={rawRows} columns={Object.keys(rawRows[0] || {})} limit={180} />
      </SectionCard>
    </>
  );
}

function CleanPage({ rows }) {
  return (
    <>
      <section className="stats-grid">
        <StatCard label="Clean rows" value={number.format(rows.length)} hint="baris kosong dibuang" />
        <StatCard label="Harga kosong" value={number.format(rows.filter((row) => !Number.isFinite(row.harga)).length)} hint="tetap dipertahankan" />
        <StatCard
          label="Tahun median"
          value={number.format(median(rows.map((row) => row.tahun).filter(Number.isFinite)))}
          hint="seluruh clean data"
        />
        <StatCard label="KM median" value={number.format(median(rows.map((row) => row.km).filter(Number.isFinite)))} hint="midpoint rentang KM" />
      </section>
      <SectionCard title="Clean Data" className="table-card">
        <DataTable rows={rows} columns={["tahun", "merk", "tipe", "jenis_mobil", "transmisi", "km", "lokasi", "penjual", "harga"]} limit={220} />
      </SectionCard>
    </>
  );
}

function RegressionTable({ rows }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fitur</TableHead>
          <TableHead>Koefisien</TableHead>
          <TableHead>Efek</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.fitur}>
            <TableCell>{row.fitur}</TableCell>
            <TableCell>{Number(row.koefisien).toFixed(3)}</TableCell>
            <TableCell>{Number(row.efek_persen).toFixed(1)}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ModelComparison({ models }) {
  return (
    <div className="model-compare">
      {models.map((item) => (
        <div className="model-row" key={item.model}>
          <div>
            <strong>{item.model}</strong>
            <span>{item.note}</span>
          </div>
          <b>{item.r2.toFixed(3)}</b>
          <b>{compactPrice(item.mae)}</b>
        </div>
      ))}
    </div>
  );
}

function ProcessingPage({ regression, metadata }) {
  const steps = [
    ["Load & Audit Awal", "Membaca mobil123_raw.csv, membuang baris kosong total, lalu menghitung kelengkapan tiap kolom sebagai baseline kualitas data."],
    ["Ekstraksi Fitur Utama", "Ekstraksi tahun, merk, tipe, jenis_mobil, parsing km, serta normalisasi transmisi, lokasi, dan penjual dari kolom mentah."],
    ["Audit Missing Jenis Mobil", "Menghitung jumlah baris jenis_mobil kosong secara eksplisit agar terlihat gap data kategori body type sebelum modeling."],
    ["Imputasi Harga per Jenis", "Jika jenis_mobil ada tetapi harga kosong, harga diisi dengan rata-rata harga pada jenis_mobil yang sama. Jika suatu jenis tidak punya referensi harga sama sekali, nilai tetap kosong agar tidak menebak."],
    ["Modeling & Perbandingan", "Membandingkan MLR harga mentah vs MLR log(harga), lalu memilih model terbaik berdasar R2 test dan MAE test."],
    ["Pengujian & Interpretasi", "Meninjau residual, error prediksi, dan koefisien terkuat agar hasil model dapat dijelaskan secara statistik dan bisnis."],
    ["Publikasi Hasil", "Menyimpan clean data, metadata audit, dan report regresi agar seluruh alur dapat ditelusuri ulang di dashboard."],
  ];

  const imputedRows = metadata?.rows_price_imputed_by_jenis || 0;
  const missingJenisRows = metadata?.missing_jenis_rows || 0;
  const unresolvedPriceRows = metadata?.rows_still_missing_price_after_imputation || 0;
  const imputableMissingRows = metadata?.rows_missing_price_with_jenis || 0;
  const imputationCoverage = imputableMissingRows ? (imputedRows / imputableMissingRows) * 100 : 0;

  return (
    <>
      {regression ? (
        <section className="stats-grid">
          <StatCard label="Model" value="Log MLR" hint={regression.selected_model} />
          <StatCard label="R2 test" value={regression.r2_test.toFixed(3)} hint="di skala log harga" />
          <StatCard label="MAE test" value={compactPrice(regression.mae_test)} hint="rata-rata error absolut" />
          <StatCard label="Median APE" value={`${regression.median_ape_test.toFixed(1)}%`} hint="median error persentase" />
        </section>
      ) : null}

      {metadata ? (
        <section className="stats-grid">
          <StatCard label="Jenis mobil kosong" value={number.format(missingJenisRows)} hint="baris tanpa kategori jenis_mobil" />
          <StatCard label="Harga diimputasi" value={number.format(imputedRows)} hint="harga terisi dari mean per jenis_mobil" />
          <StatCard label="Coverage imputasi" value={`${imputationCoverage.toFixed(1)}%`} hint="dari baris harga kosong yang punya jenis_mobil" />
          <StatCard label="Sisa harga kosong" value={number.format(unresolvedPriceRows)} hint="butuh data referensi tambahan" />
        </section>
      ) : null}

      <section className="grid-two">
        <SectionCard title="Alur Processing">
          <div className="process-list">
            {steps.map(([title, body], index) => (
              <div className="process-step" key={title}>
                <strong>{index + 1}. {title}</strong>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Formula Regresi">
          <p>{regression?.formula || "harga = b0 + b1*x1 + b2*x2 + ... + error"}</p>
          <div className="pill-list">
            {(regression?.feature_columns || []).map((feature) => (
              <Badge key={feature} variant="neutral">{feature}</Badge>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid-two">
        <SectionCard title="Audit Missing & Imputasi Harga">
          <ul className="notes">
            <li>Total baris clean: {number.format(metadata?.clean_rows || 0)}.</li>
            <li>Baris jenis_mobil kosong: {number.format(missingJenisRows)}.</li>
            <li>Baris harga asli kosong: {number.format(metadata?.missing_price_rows_original || 0)}.</li>
            <li>Baris harga kosong tetapi punya jenis_mobil: {number.format(imputableMissingRows)}.</li>
            <li>Baris berhasil diimputasi dengan mean per jenis_mobil: {number.format(imputedRows)}.</li>
            <li>Baris tetap kosong setelah imputasi: {number.format(unresolvedPriceRows)}.</li>
          </ul>
        </SectionCard>

        <SectionCard title="Rata-rata Harga per Jenis Mobil (Top 10)">
          <BarChart
            data={(metadata?.mean_price_by_jenis || []).slice(0, 10).map((item) => ({ label: item.jenis_mobil, value: item.mean_harga }))}
            color={COLORS[3]}
            valueFormat={(value) => compactPrice(value)}
          />
        </SectionCard>
      </section>

      {regression ? (
        <section className="grid-two">
          <SectionCard title="Alur Penelitian">
            <div className="process-list">
              {(regression.research_flow || []).map((item) => (
                <div className="process-step" key={item.phase}>
                  <strong>{item.phase}</strong>
                  <p>{item.description}</p>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Alur Pengujian">
            <ol className="ordered-notes">
              {(regression.testing_protocol || []).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </SectionCard>
        </section>
      ) : null}

      {regression ? (
        <section className="grid-two">
          <SectionCard title="Perbandingan Model">
            <div className="compare-head">
              <span>Model</span>
              <span>R2</span>
              <span>MAE</span>
            </div>
            <ModelComparison models={regression.model_comparison} />
          </SectionCard>
          <SectionCard title="Actual vs Predicted">
            <PredictionPlot rows={regression.evaluation_points} />
          </SectionCard>
        </section>
      ) : null}

      {regression ? (
        <section className="grid-two">
          <SectionCard title="Distribusi Residual">
            <Histogram data={histogram(regression.evaluation_points, "residual_log_mlr", 12, (v) => compactPrice(v))} color={COLORS[0]} />
          </SectionCard>
          <SectionCard title="Interpretasi Model">
            <ul className="notes">
              <li>{regression.interpretation_note}</li>
              <li>Titik yang jauh dari garis diagonal di plot actual-vs-predicted adalah listing dengan error prediksi besar.</li>
              <li>Model ini masih baseline linear, jadi cocok untuk pembelajaran interpretasi dan evaluasi awal.</li>
            </ul>
          </SectionCard>
        </section>
      ) : null}

      {regression ? (
        <section className="grid-three">
          <SectionCard title="Koefisien Positif Terbesar">
            <RegressionTable rows={regression.top_positive_coefficients} />
          </SectionCard>
          <SectionCard title="Koefisien Negatif Terbesar">
            <RegressionTable rows={regression.top_negative_coefficients} />
          </SectionCard>
          <SectionCard title="Pengaruh Absolut Terbesar">
            <RegressionTable rows={regression.top_impact_coefficients} />
          </SectionCard>
        </section>
      ) : null}
    </>
  );
}

function EdaPage({ rows, priced }) {
  const missing = missingSummary(rows, ["tahun", "merk", "tipe", "jenis_mobil", "transmisi", "km", "lokasi", "penjual", "harga"]);
  const outliers = outlierSummary(priced, "harga");

  return (
    <>
      <section className="grid-two">
        <SectionCard title="Distribusi Harga">
          <Histogram data={histogram(priced, "harga", 12)} color={COLORS[1]} />
        </SectionCard>
        <SectionCard title="Distribusi Tahun">
          <Histogram data={histogram(rows, "tahun", 12, (v) => `${Math.round(v)}`)} color={COLORS[0]} />
        </SectionCard>
      </section>

      <section className="grid-three">
        <SectionCard title="Jenis Mobil">
          <BarChart data={groupCount(rows, "jenis_mobil").slice(0, 12)} color={COLORS[5]} />
        </SectionCard>
        <SectionCard title="Transmisi">
          <BarChart data={groupCount(rows, "transmisi")} color={COLORS[4]} />
        </SectionCard>
        <SectionCard title="Penjual">
          <BarChart data={groupCount(rows, "penjual")} color={COLORS[2]} />
        </SectionCard>
      </section>

      <section className="grid-three">
        <SectionCard title="Missing Value">
          <BarChart data={missing} color={COLORS[0]} />
        </SectionCard>
        <SectionCard title="Top Tipe Mobil">
          <BarChart data={groupCount(rows, "tipe").slice(0, 12)} color={COLORS[2]} />
        </SectionCard>
        <SectionCard title="Outlier Harga">
          <div className="summary-list">
            <p>Outlier terdeteksi: {number.format(outliers.outliers.length)} listing.</p>
            <p>Batas bawah: {compactPrice(outliers.low)}.</p>
            <p>Batas atas: {compactPrice(outliers.high)}.</p>
          </div>
        </SectionCard>
      </section>

      <section className="grid-two">
        <SectionCard title="Sebaran Harga per Transmisi">
          <BoxPlot rows={priced} groupKey="transmisi" />
        </SectionCard>
        <SectionCard title="Sebaran Harga per Penjual">
          <BoxPlot rows={priced} groupKey="penjual" />
        </SectionCard>
      </section>
    </>
  );
}

function CorrelationPage({ priced }) {
  const insights = correlationInsights(priced);
  const strongestPositive = insights.filter((item) => item.value > 0).sort((a, b) => b.value - a.value)[0];
  const strongestNegative = insights.filter((item) => item.value < 0).sort((a, b) => a.value - b.value)[0];

  return (
    <>
      <section className="grid-two">
        <SectionCard title="Heatmap Korelasi">
          <Heatmap rows={priced} />
        </SectionCard>
        <SectionCard title="Insight Korelasi">
          <ul className="notes">
            {strongestPositive ? <li>Korelasi positif terkuat terhadap harga: {strongestPositive.label} ({strongestPositive.value.toFixed(2)}).</li> : null}
            {strongestNegative ? <li>Korelasi negatif terkuat terhadap harga: {strongestNegative.label} ({strongestNegative.value.toFixed(2)}).</li> : null}
            <li>Korelasi positif berarti dua variabel cenderung naik bersama.</li>
            <li>Korelasi negatif berarti ketika satu variabel naik, variabel lain cenderung turun.</li>
            <li>Korelasi tidak membuktikan sebab-akibat; ini dipakai sebagai petunjuk awal sebelum modeling.</li>
          </ul>
        </SectionCard>
      </section>

      <section className="grid-two">
        <SectionCard title="Ranking Korelasi ke Harga">
          <BarChart
            data={insights.map((item) => ({ label: item.label, value: Math.abs(item.value), raw: item.value })).slice(0, 10)}
            color={COLORS[0]}
            valueFormat={(_, item) => item.raw.toFixed(2)}
          />
        </SectionCard>
        <SectionCard title="Catatan Dummy Kategori">
          <p>Kolom seperti is_suv atau is_mpv adalah dummy 0/1. Korelasinya membaca kecenderungan kategori tersebut terhadap harga, bukan efek kausal langsung.</p>
        </SectionCard>
      </section>

      <section className="grid-two">
        <SectionCard title="Tahun vs Harga">
          <ScatterPlot rows={priced} xKey="tahun" yKey="harga" xLabel="Tahun" yLabel="Harga" color={COLORS[4]} />
        </SectionCard>
        <SectionCard title="KM vs Harga">
          <ScatterPlot rows={priced} xKey="km" yKey="harga" xLabel="Kilometer" yLabel="Harga" color={COLORS[2]} />
        </SectionCard>
      </section>
    </>
  );
}

function ConclusionPage({ rows, priced, regression }) {
  const topBrand = groupCount(rows, "merk")[0];
  const topLocation = groupCount(rows, "lokasi")[0];
  const medPrice = compactPrice(median(priced.map((row) => row.harga)));

  return (
    <section className="conclusion">
      <SectionCard title="Kesimpulan Utama">
        <ul className="notes">
          <li>Dataset bersih berisi {number.format(rows.length)} listing, dengan {number.format(priced.length)} listing memiliki harga.</li>
          <li>Merk paling sering muncul adalah {topBrand?.label || "-"} dan lokasi terbanyak adalah {topLocation?.label || "-"}.</li>
          <li>Median harga listing yang tersedia berada di kisaran {medPrice}.</li>
          <li>Tahun kendaraan, kilometer, merk, jenis mobil, transmisi, lokasi, dan tipe penjual layak dipakai sebagai variabel analisis harga.</li>
          {regression ? <li>Model terbaik saat ini adalah {regression.selected_model}, dengan R2 test {regression.r2_test.toFixed(3)} dan MAE {compactPrice(regression.mae_test)}.</li> : null}
        </ul>
      </SectionCard>

      <SectionCard title="Arahan Lanjutan">
        <p>Untuk analisis prediktif, data yang harga kosong bisa dipisahkan dari training set. Transformasi log harga juga relevan karena harga mobil biasanya condong ke kanan dan memiliki outlier.</p>
      </SectionCard>
    </section>
  );
}

function Header({ page }) {
  return (
    <>
      <header className="topbar">
        <div>
          <p className="hero-kicker">Mobil123 Used Car Analytics</p>
          <h1>{routes.find(([key]) => key === page)?.[1] || "Dashboard"}</h1>
        </div>
        <Button asChild size="sm">
          <a href="/data/mobil123_clean.json" target="_blank" rel="noreferrer">
            Buka JSON
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </Button>
      </header>

      <nav className="tabs-glass">
        {routes.map(([key, label]) => (
          <a key={key} href={`#/${key}`} className={page === key ? "active" : ""}>
            {label}
          </a>
        ))}
      </nav>
    </>
  );
}

function App() {
  const [rows, setRows] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [regression, setRegression] = useState(null);
  const [metadata, setMetadata] = useState(null);
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
      fetch("/data/mobil123_clean.json").then((response) => response.json()),
      fetch("/data/mobil123_raw.json").then((response) => response.json()),
      fetch("/data/mobil123_metadata.json").then((response) => response.json()),
      fetch("/data/mobil123_regression.json").then((response) => response.json()),
    ])
      .then(([clean, raw, metadataReport, regressionReport]) => {
        setRows(clean);
        setRawRows(raw);
        setMetadata(metadataReport);
        setRegression(regressionReport);
      })
      .catch((err) => setError(`Gagal load data: ${err.message}`));
  }, []);

  const options = useMemo(() => {
    const unique = (key) => [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort();
    return {
      merk: unique("merk"),
      lokasi: unique("lokasi"),
      transmisi: unique("transmisi"),
      jenis_mobil: unique("jenis_mobil"),
    };
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows
        .filter((row) => {
          const search = filters.search.trim().toLowerCase();
          if (search) {
            const text = [row.merk, row.tipe, row.jenis_mobil, row.lokasi, row.penjual].filter(Boolean).join(" ").toLowerCase();
            if (!text.includes(search)) return false;
          }
          if (filters.merk && row.merk !== filters.merk) return false;
          if (filters.lokasi && row.lokasi !== filters.lokasi) return false;
          if (filters.transmisi && row.transmisi !== filters.transmisi) return false;
          if (filters.jenis_mobil && row.jenis_mobil !== filters.jenis_mobil) return false;
          if (filters.minYear && Number(row.tahun) < Number(filters.minYear)) return false;
          if (filters.maxYear && Number(row.tahun) > Number(filters.maxYear)) return false;
          if (filters.minPrice && Number.isFinite(row.harga) && row.harga < Number(filters.minPrice)) return false;
          if (filters.maxPrice && Number.isFinite(row.harga) && row.harga > Number(filters.maxPrice)) return false;
          return true;
        })
        .sort((a, b) => {
          const av = a[filters.sortKey];
          const bv = b[filters.sortKey];
          const emptyA = av === null || av === undefined;
          const emptyB = bv === null || bv === undefined;
          if (emptyA && emptyB) return 0;
          if (emptyA) return 1;
          if (emptyB) return -1;
          const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
          return filters.sortDir === "asc" ? result : -result;
        }),
    [rows, filters]
  );

  const priced = filtered.filter((row) => Number.isFinite(row.harga));
  const allPriced = rows.filter((row) => Number.isFinite(row.harga));

  if (error)
    return (
      <main className="app-shell">
        <div className="error">{error}</div>
      </main>
    );

  if (!rows.length || !rawRows.length)
    return (
      <main className="app-shell">
        <div className="loading">Memuat data...</div>
      </main>
    );

  const pageNode = {
    landing: <LandingPage cleanRows={rows} rawRows={rawRows} pricedRows={allPriced} />,
    dashboard: <DashboardPage rows={rows} filtered={filtered} priced={priced} filters={filters} setFilters={setFilters} options={options} />,
    raw: <RawPage rawRows={rawRows} />,
    clean: <CleanPage rows={rows} />,
    processing: <ProcessingPage regression={regression} metadata={metadata} />,
    eda: <EdaPage rows={rows} priced={allPriced} />,
    correlation: <CorrelationPage priced={allPriced} />,
    conclusion: <ConclusionPage rows={rows} priced={allPriced} regression={regression} />,
  }[page];

  return (
    <main className="app-shell">
      <div className="ambient-shape" />
      <div className="ambient-shape second" />
      <div className="app-frame">
        <Header page={page} />
        <Separator className="my-10 opacity-30" />
        <div className="page-content">
          <div className="mb-6 flex items-center gap-2 text-sm text-[color:var(--color-on-surface-muted)]">
            <Activity className="h-4 w-4" />
            Insight Workspace
          </div>
          {pageNode}
        </div>
      </div>
    </main>
  );
}

export default App;
