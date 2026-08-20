#!/usr/bin/env python3
"""Gera o SVG dos municipios de Sao Paulo a partir do dataset IBGE (npm ibge-cidades-com-poligonos)."""
import ast, json, math, unicodedata, os

SRC = "/tmp/geo/node_modules/ibge-cidades-com-poligonos/municipios-poligonos.json"
OUT_DIR = "/home/claude/mapa-imoveis/site"
W = 1600.0          # largura do viewBox
TOL = 0.0022        # tolerancia RDP em graus (~200m)
DEC = 1             # casas decimais nas coordenadas do SVG

def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-")

def merc(lon, lat):
    x = math.radians(lon)
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y

def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    stack = [(0, len(pts) - 1)]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = pts[i]; bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        dmax, idx = -1.0, i
        for k in range(i + 1, j):
            px, py = pts[k]
            if norm == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > dmax:
                dmax, idx = d, k
        if dmax > eps:
            keep[idx] = True
            stack.append((i, idx)); stack.append((idx, j))
    return [p for p, k in zip(pts, keep) if k]

def rings_of(geom):
    t = geom["type"]; c = geom["coordinates"]
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return c
    raise ValueError(t)

def main():
    data = json.load(open(SRC))
    sp = [m for m in data if m["ufSigla"] == "SP"]
    print("municipios SP:", len(sp))

    feats = []
    for m in sp:
        geom = ast.literal_eval(m["poligono"]) if isinstance(m["poligono"], str) else m["poligono"]
        polys = []
        for poly in rings_of(geom):
            simplified = []
            for ring in poly:
                r = [(float(a), float(b)) for a, b in ring]
                r = rdp(r, TOL)
                if len(r) >= 4:
                    simplified.append(r)
            if simplified:
                polys.append(simplified)
        if not polys:
            continue
        feats.append({
            "code": m["municipioCodigo"],
            "name": m["municipioNome"],
            "meso": m["mesorregiaoNome"],
            "micro": m["microrregiaoNome"],
            "polys": polys,
        })

    # projecao
    xs, ys = [], []
    for f in feats:
        for poly in f["polys"]:
            for ring in poly:
                for lon, lat in ring:
                    x, y = merc(lon, lat)
                    xs.append(x); ys.append(y)
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    scale = W / (maxx - minx)
    H = (maxy - miny) * scale

    def proj(lon, lat):
        x, y = merc(lon, lat)
        return round((x - minx) * scale, DEC), round((maxy - y) * scale, DEC)

    paths, meta = [], []
    for f in sorted(feats, key=lambda z: z["name"]):
        d = []
        cx = cy = area = 0.0
        for poly in f["polys"]:
            for ring in poly:
                pts = [proj(lon, lat) for lon, lat in ring]
                # remove pontos consecutivos identicos apos arredondamento
                dedup = [pts[0]]
                for p in pts[1:]:
                    if p != dedup[-1]:
                        dedup.append(p)
                if len(dedup) < 3:
                    continue
                d.append("M" + " ".join(f"{x},{y}" for x, y in dedup) + "Z")
            # centroide aproximado do anel externo (maior area)
            outer = [proj(lon, lat) for lon, lat in poly[0]]
            a = 0.0; sx = sy = 0.0
            for i in range(len(outer) - 1):
                x0, y0 = outer[i]; x1, y1 = outer[i + 1]
                cross = x0 * y1 - x1 * y0
                a += cross; sx += (x0 + x1) * cross; sy += (y0 + y1) * cross
            if a != 0:
                a2 = a / 2
                if abs(a2) > abs(area):
                    area = a2; cx = sx / (3 * a); cy = sy / (3 * a)
        if not d:
            continue
        paths.append(
            f'<path id="m{f["code"]}" class="city" data-code="{f["code"]}" '
            f'data-name="{f["name"]}" d="{"".join(d)}"><title>{f["name"]}</title></path>'
        )
        meta.append({
            "code": f["code"], "name": f["name"], "slug": slug(f["name"]),
            "meso": f["meso"], "micro": f["micro"],
            "cx": round(cx, 1), "cy": round(cy, 1),
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" id="sp-map" viewBox="0 0 {W:.0f} {H:.0f}" '
        f'preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa dos municipios de Sao Paulo">\n'
        f'<g id="cities">\n' + "\n".join(paths) + "\n</g>\n</svg>\n"
    )
    open(f"{OUT_DIR}/sp-map.svg", "w", encoding="utf-8").write(svg)
    with open(f"{OUT_DIR}/cities.js", "w", encoding="utf-8") as fh:
        fh.write("window.SP_CITIES = " + json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + ";\n")

    print(f"viewBox 0 0 {W:.0f} {H:.0f}")
    print("svg kb:", round(len(svg) / 1024))
    print("cities:", len(meta))

if __name__ == "__main__":
    main()
