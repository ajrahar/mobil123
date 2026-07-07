export const COLORS = ["#ff682c", "#202020", "#816729", "#4d4d4d", "#828282", "#cfc7bb", "#a44a25"];

export const routes = [
  ["landing", "Landing"],
  ["dashboard", "Dashboard"],
  ["predict", "Predict Demo"],
  ["raw", "Raw Data"],
  ["clean", "Clean Data"],
  ["processing", "Processing"],
  ["eda", "EDA"],
  ["correlation", "Korelasi"],
  ["conclusion", "Kesimpulan"],
];

export const defaultFilters = {
  merk: "",
  lokasi: "",
  transmisi: "",
  jenis_mobil: "",
  minYear: "",
  maxYear: "",
  minPrice: "",
  maxPrice: "",
  search: "",
  sortKey: "harga",
  sortDir: "desc",
};
