"""Build frontend/data/melbourne-public-toilets.json from City of Melbourne CSV."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "frontend" / "data" / "public-toilets-source.csv"
OUT = ROOT / "frontend" / "data" / "melbourne-public-toilets.json"


def is_yes(value: str) -> bool:
    return (value or "").strip().lower() == "yes"


def main() -> None:
    toilets = []
    with CSV.open(encoding="utf-8", newline="") as handle:
        for i, row in enumerate(csv.DictReader(handle), 1):
            lat = row.get("lat", "").strip()
            lng = row.get("lon", "").strip()
            if not lat or not lng:
                continue
            toilets.append(
                {
                    "id": f"city-toilet-{i}",
                    "name": (row.get("name") or "Public toilet").strip(),
                    "lat": float(lat),
                    "lng": float(lng),
                    "emoji": "🚽",
                    "source": (row.get("operator") or "City of Melbourne").strip()
                    or "City of Melbourne",
                    "female": is_yes(row.get("female", "")),
                    "male": is_yes(row.get("male", "")),
                    "wheelchair": is_yes(row.get("wheelchair", "")),
                    "babyChanging": is_yes(row.get("baby_facil", "")),
                }
            )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(toilets, indent=2), encoding="utf-8")
    print(f"Wrote {len(toilets)} toilets to {OUT}")


if __name__ == "__main__":
    main()
