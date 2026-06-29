import argparse
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


MULTI_WORD_BRANDS = ["Land Rover", "Mercedes-Benz", "Aston Martin", "Alfa Romeo"]
BODY_TYPE_PREFIXES = [
    "SUV",
    "MPV",
    "Sedan",
    "Hatchback",
    "PHEV",
    "Coupe",
    "Convertible",
    "Pickup",
    "Truck",
    "Van",
    "Fastback",
    "Wagon",
]


def extract_year(ellipsize_text):
    match = re.match(r"^(\d{4})", str(ellipsize_text))
    return int(match.group(1)) if match else None


def split_brand_type(model_text):
    if pd.isna(model_text):
        return None, None
    for brand in MULTI_WORD_BRANDS:
        if str(model_text).startswith(brand):
            return brand, str(model_text)[len(brand) :].strip() or None
    parts = str(model_text).split(" ", 1)
    return parts[0], parts[1] if len(parts) > 1 else None


def from_ellipsize(ellipsize_text):
    text = re.sub(r"^\d{4}\s+", "", str(ellipsize_text))
    text = text.split(" - ")[0]
    for brand in MULTI_WORD_BRANDS:
        if text.startswith(brand):
            return brand, text[len(brand) :].strip() or None
    parts = text.split(" ", 1)
    return parts[0], parts[1] if len(parts) > 1 else None


def trim_trailing_bodytype(tipe_text):
    if pd.isna(tipe_text):
        return tipe_text
    words = str(tipe_text).split()
    words = [word for word in words if not re.match(r"^\d+\.\d+$", word)]
    while words:
        last = words[-1].rstrip(".")
        is_bodytype = any(
            last == body_type or (len(last) >= 3 and body_type.startswith(last))
            for body_type in BODY_TYPE_PREFIXES
        )
        if not is_bodytype:
            break
        words.pop()
    return " ".join(words).strip() or None


def extract_body_type(ellipsize_text):
    core = str(ellipsize_text).split(" - ")[0]
    core = re.sub(r"\.\.\.$", "", core).strip()
    words = core.split()
    if not words:
        return None
    last = words[-1].rstrip(".")
    for body_type in BODY_TYPE_PREFIXES:
        if last == body_type:
            return body_type
    return None


def parse_km(raw, method="midpoint"):
    if pd.isna(raw):
        return None

    text = str(raw).upper().strip().replace("KM", "").strip().replace(",", ".")

    def to_number(token):
        token = token.strip()
        if token == "":
            return None
        multiplier = 1
        if token.endswith("JT"):
            multiplier = 1_000_000
            token = token[:-2].strip()
        elif token.endswith("K"):
            multiplier = 1_000
            token = token[:-1].strip()
        try:
            return float(token) * multiplier
        except ValueError:
            return None

    range_match = re.match(r"^([\d.]+K?)\s*-\s*([\d.]+K?)\+?$", text)
    if range_match:
        raw_lo, raw_hi = range_match.groups()
        if raw_hi.endswith("K") and not raw_lo.endswith("K"):
            raw_lo += "K"
        lo, hi = to_number(raw_lo), to_number(raw_hi)
        if lo is None or hi is None:
            return None
        if method == "lower":
            return lo
        if method == "upper":
            return hi
        return (lo + hi) / 2

    plus_match = re.match(r"^([\d.]+K?)\+$", text)
    if plus_match:
        return to_number(plus_match.group(1))

    single_match = re.match(r"^([\d.]+K?)$", text)
    if single_match:
        return to_number(single_match.group(1))

    return None


def parse_harga(raw):
    if pd.isna(raw):
        return None
    digits = re.sub(r"[^\d]", "", str(raw))
    return int(digits) if digits else None


def clean_data(raw_path):
    df_raw = pd.read_csv(raw_path)
    df = df_raw.dropna(how="all").reset_index(drop=True)

    df["tahun"] = df["ellipsize"].apply(extract_year)
    df["jenis_mobil"] = df["ellipsize"].apply(extract_body_type)

    brand_type = df["listing__rating-model"].apply(split_brand_type)
    df["merk"] = brand_type.apply(lambda item: item[0])
    df["tipe"] = brand_type.apply(lambda item: item[1])
    df["tipe_truncated"] = False

    fallback_mask = df["merk"].isna()
    for index in df[fallback_mask].index:
        merk, tipe = from_ellipsize(df.loc[index, "ellipsize"])
        df.loc[index, "merk"] = merk
        df.loc[index, "tipe"] = tipe
        if str(df.loc[index, "ellipsize"]).endswith("..."):
            df.loc[index, "tipe_truncated"] = True

    df["tipe"] = df["tipe"].str.split(" - ").str[0]
    df["tipe"] = df["tipe"].str.replace(r"\.\.\.$", "", regex=True).str.strip()
    df["tipe"] = df["tipe"].apply(trim_trailing_bodytype)
    df["km"] = df["item"].apply(parse_km)
    df["transmisi"] = df["item 2"]
    df["lokasi"] = df["item 3"]
    df["penjual"] = df["item 4"]
    df["harga"] = df["listing__price"].apply(parse_harga)

    dummy_jenis = pd.get_dummies(df["jenis_mobil"], prefix="is").astype(int)
    dummy_jenis.columns = [column.lower() for column in dummy_jenis.columns]
    df = pd.concat([df, dummy_jenis], axis=1)

    dummy_cols = [column for column in df.columns if column.startswith("is_")]
    final_cols = [
        "tahun",
        "merk",
        "tipe",
        "tipe_truncated",
        "jenis_mobil",
        *dummy_cols,
        "transmisi",
        "km",
        "lokasi",
        "penjual",
        "harga",
    ]
    clean = df[final_cols].copy()
    clean = clean.replace({np.nan: None})
    return df_raw, clean


def build_metadata(raw_df, clean_df):
    priced = clean_df.dropna(subset=["harga"])
    numeric_cols = [
        column
        for column in ["tahun", "km", "harga", *[c for c in clean_df.columns if c.startswith("is_")]]
        if column in priced.columns
    ]
    corr = priced[numeric_cols].corr(numeric_only=True).round(4).replace({np.nan: None})

    return {
        "raw_rows": int(len(raw_df)),
        "clean_rows": int(len(clean_df)),
        "priced_rows": int(clean_df["harga"].notna().sum()),
        "missing_price_rows": int(clean_df["harga"].isna().sum()),
        "generated_from": "mobil123_raw.csv",
        "columns": clean_df.columns.tolist(),
        "correlation": {
            "columns": corr.columns.tolist(),
            "matrix": corr.values.tolist(),
        },
    }


def build_regression_report(clean_df):
    model_df = clean_df.dropna(subset=["harga", "tahun", "km", "merk", "transmisi"]).copy()
    model_df["harga"] = pd.to_numeric(model_df["harga"], errors="coerce")
    model_df["tahun"] = pd.to_numeric(model_df["tahun"], errors="coerce")
    model_df["km"] = pd.to_numeric(model_df["km"], errors="coerce")
    model_df = model_df.dropna(subset=["harga", "tahun", "km"])
    model_df = model_df[model_df["harga"] > 0].copy()
    model_df["usia_mobil"] = 2026 - model_df["tahun"]
    model_df["log_harga"] = np.log(model_df["harga"])

    dummy_cols = [column for column in model_df.columns if column.startswith("is_")]
    feature_cols = ["usia_mobil", "km", "merk", "transmisi", "penjual", "jenis_mobil", *dummy_cols]
    categorical_cols = ["merk", "transmisi", "penjual", "jenis_mobil"]
    numeric_cols = ["usia_mobil", "km", *dummy_cols]

    X = model_df[feature_cols]
    y_price = model_df["harga"]
    y_log = model_df["log_harga"]

    preprocessor = ColumnTransformer(
        [
            (
                "cat",
                OneHotEncoder(handle_unknown="ignore", drop="first", sparse_output=False),
                categorical_cols,
            ),
            ("num", "passthrough", numeric_cols),
        ]
    )
    raw_model = Pipeline([("prep", preprocessor), ("lr", LinearRegression())])
    log_model = Pipeline([("prep", preprocessor), ("lr", LinearRegression())])

    X_train, X_test, y_price_train, y_price_test, y_log_train, y_log_test = train_test_split(
        X,
        y_price,
        y_log,
        test_size=0.2,
        random_state=42,
    )
    raw_model.fit(X_train, y_price_train)
    raw_pred_price = raw_model.predict(X_test)

    log_model.fit(X_train, y_log_train)
    pred_log = log_model.predict(X_test)
    pred_price_from_log = np.exp(pred_log)

    raw_model.fit(X, y_price)
    log_model.fit(X, y_log)
    feature_names = log_model.named_steps["prep"].get_feature_names_out()
    coefficients = pd.DataFrame(
        {
            "fitur": feature_names,
            "koefisien": log_model.named_steps["lr"].coef_,
        }
    )
    coefficients["efek_persen"] = (np.exp(coefficients["koefisien"]) - 1) * 100
    coefficients["abs_koefisien"] = coefficients["koefisien"].abs()
    top_positive = coefficients.sort_values("koefisien", ascending=False).head(12)
    top_negative = coefficients.sort_values("koefisien", ascending=True).head(12)
    top_impact = coefficients.sort_values("abs_koefisien", ascending=False).head(18)

    evaluation = pd.DataFrame(
        {
            "actual": y_price_test,
            "predicted_raw_mlr": raw_pred_price,
            "predicted_log_mlr": pred_price_from_log,
        }
    )
    evaluation["residual_log_mlr"] = evaluation["actual"] - evaluation["predicted_log_mlr"]
    evaluation["absolute_error_log_mlr"] = evaluation["residual_log_mlr"].abs()
    evaluation["absolute_percentage_error_log_mlr"] = (
        evaluation["absolute_error_log_mlr"] / evaluation["actual"]
    ) * 100
    evaluation = evaluation.replace([np.inf, -np.inf], np.nan).dropna()

    raw_mae = mean_absolute_error(y_price_test, raw_pred_price)
    log_mae = mean_absolute_error(y_price_test, pred_price_from_log)
    raw_r2 = r2_score(y_price_test, raw_pred_price)
    log_r2 = r2_score(y_log_test, pred_log)

    return {
        "model_name": "Multiple Linear Regression",
        "selected_model": "Log-target Multiple Linear Regression",
        "target": "log_harga",
        "target_original": "harga",
        "target_unit": "log Rupiah, converted back to Rupiah for MAE",
        "feature_columns": feature_cols,
        "categorical_columns": categorical_cols,
        "numeric_columns": numeric_cols,
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "r2_test": float(log_r2),
        "mae_test": float(log_mae),
        "median_ape_test": float(evaluation["absolute_percentage_error_log_mlr"].median()),
        "intercept": float(log_model.named_steps["lr"].intercept_),
        "model_comparison": [
            {
                "model": "MLR harga mentah",
                "target": "harga",
                "r2": float(raw_r2),
                "mae": float(raw_mae),
                "note": "Baseline linear regression langsung ke Rupiah.",
            },
            {
                "model": "MLR log(harga)",
                "target": "log_harga",
                "r2": float(log_r2),
                "mae": float(log_mae),
                "note": "Target ditransformasi log lalu prediksi dikembalikan ke Rupiah.",
            },
        ],
        "top_positive_coefficients": top_positive[["fitur", "koefisien", "efek_persen"]].to_dict(orient="records"),
        "top_negative_coefficients": top_negative[["fitur", "koefisien", "efek_persen"]].to_dict(orient="records"),
        "top_impact_coefficients": top_impact[["fitur", "koefisien", "efek_persen"]].to_dict(orient="records"),
        "evaluation_points": evaluation.sort_values("absolute_error_log_mlr", ascending=False)
        .head(220)[["actual", "predicted_log_mlr", "residual_log_mlr", "absolute_percentage_error_log_mlr"]]
        .to_dict(orient="records"),
        "formula": "log(harga) = intercept + b1*usia_mobil + b2*km + b3*merk + b4*transmisi + b5*penjual + b6*jenis_mobil + dummy_jenis",
        "interpretation_note": "Koefisien pada model log dapat dibaca sebagai perkiraan perubahan persentase harga, dengan asumsi fitur lain tetap.",
    }


def export_outputs(raw_df, clean_df, metadata, regression_report, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_df.replace({np.nan: None}).to_json(output_dir / "mobil123_raw.json", orient="records", indent=2)
    clean_df.to_json(output_dir / "mobil123_clean.json", orient="records", indent=2)
    clean_df.to_csv(output_dir / "mobil123_clean.csv", index=False)
    with (output_dir / "mobil123_metadata.json").open("w") as file:
        json.dump(metadata, file, indent=2)
    with (output_dir / "mobil123_regression.json").open("w") as file:
        json.dump(regression_report, file, indent=2)

    try:
        clean_df.to_parquet(output_dir / "mobil123_clean.parquet", index=False)
        parquet_status = "saved"
    except Exception as exc:
        parquet_status = f"skipped: {exc.__class__.__name__}: {exc}"

    return parquet_status


def main():
    parser = argparse.ArgumentParser(description="Clean mobil123 raw CSV for the React dashboard.")
    parser.add_argument("--input", default="mobil123_raw.csv", help="Path to the raw CSV file.")
    parser.add_argument("--output-dir", default="data", help="Directory for cleaned data outputs.")
    args = parser.parse_args()

    raw_df, clean_df = clean_data(Path(args.input))
    metadata = build_metadata(raw_df, clean_df)
    regression_report = build_regression_report(clean_df)
    parquet_status = export_outputs(raw_df, clean_df, metadata, regression_report, Path(args.output_dir))

    print(f"Raw rows: {metadata['raw_rows']}")
    print(f"Clean rows: {metadata['clean_rows']}")
    print(f"Rows with price: {metadata['priced_rows']}")
    print(f"Missing price rows: {metadata['missing_price_rows']}")
    print(f"Multiple linear regression R2 test: {regression_report['r2_test']:.4f}")
    print(f"Multiple linear regression MAE test: {regression_report['mae_test']:.0f}")
    print(f"JSON/CSV saved to: {Path(args.output_dir).resolve()}")
    print(f"Parquet: {parquet_status}")


if __name__ == "__main__":
    main()
