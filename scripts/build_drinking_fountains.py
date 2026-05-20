"""Build frontend/data/melbourne-drinking-fountains.json from City of Melbourne open data."""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TSV = ROOT / "frontend" / "data" / "drinking-fountains-source.tsv"
OUT = ROOT / "frontend" / "data" / "melbourne-drinking-fountains.json"
GEOJSON_URL = (
    "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/"
    "drinking-fountains/exports/geojson"
)


def from_tsv() -> list[dict]:
    fountains = []
    for line in TSV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("Description"):
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        lat = float(parts[-2])
        lng = float(parts[-1])
        desc = parts[0].strip()
        fountains.append(
            {
                "id": f"city-fountain-{len(fountains) + 1}",
                "description": desc,
                "lat": lat,
                "lng": lng,
                "emoji": "💧",
                "source": "City of Melbourne",
            }
        )
    return fountains


def from_open_data() -> list[dict]:
    req = urllib.request.Request(GEOJSON_URL, headers={"User-Agent": "EmergentApp1/1.0"})
    geo = json.load(urllib.request.urlopen(req, timeout=60))
    fountains = []
    for i, feat in enumerate(geo.get("features", []), 1):
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or []
        lat = props.get("lat")
        lng = props.get("lon")
        if lat is None and len(coords) >= 2:
            lng, lat = coords[0], coords[1]
        if lat is None or lng is None:
            continue
        desc = (props.get("description") or "Public drinking fountain").strip()
        fountains.append(
            {
                "id": f"city-fountain-{i}",
                "description": desc,
                "lat": float(lat),
                "lng": float(lng),
                "emoji": "💧",
                "source": "City of Melbourne",
            }
        )
    return fountains


def main() -> None:
    fountains = from_tsv() if TSV.is_file() else from_open_data()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fountains, indent=2), encoding="utf-8")
    print(f"Wrote {len(fountains)} fountains to {OUT}")


if __name__ == "__main__":
    main()
