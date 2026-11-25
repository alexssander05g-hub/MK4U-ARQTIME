#!/usr/bin/env python3
"""
Itens de saúde e higiene pessoal para a gôndola (SketchUp).
Saída em higiene/ : DAE, OBJ, STL, script Ruby e preview.
Milímetros, Z para cima. Rode: python3 gerar_higiene.py
"""
import math
import os
import zipfile

import numpy as np
import trimesh

import gerar_blocos as gb
from gerar_potes import box, extrude_polygon_x

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "higiene")
TAU = math.tau


# ---------------------------------------------------------------------------
# Primitivas extras
# ---------------------------------------------------------------------------
def superlathe(profile, n=32, exp=2.0, closed=False):
    """Como gb.lathe, mas cada anel é uma superelipse (a, b, z).
    exp=2 elipse; exp 3-5 retângulo arredondado. a=b=0 vira polo."""
    mb = gb.MeshBuilder()
    rings = []
    for (a, b, z) in profile:
        if a <= 1e-9 or b <= 1e-9:
            rings.append([mb.add_vertex((0, 0, z))] * n)
            continue
        ring = []
        for i in range(n):
            th = TAU * i / n
            c, s = math.cos(th), math.sin(th)
            x = a * math.copysign(abs(c) ** (2 / exp), c)
            y = b * math.copysign(abs(s) ** (2 / exp), s)
            ring.append(mb.add_vertex((x, y, z)))
        rings.append(ring)
    edges = list(zip(range(len(profile)), range(1, len(profile))))
    if closed:
        edges.append((len(profile) - 1, 0))
    for p, q in edges:
        for i in range(n):
            j = (i + 1) % n
            mb.add_quad(rings[p][i], rings[p][j], rings[q][j], rings[q][i])
    return mb.result()


def rounded_block(A, B, h, r, exp=4.0, n=32, nz=6):
    """Bloco com arestas arredondadas (sabonete, pacote macio).
    A, B = meias-larguras em X e Y; h = altura; r = raio das arestas."""
    prof = [(0, 0, 0)]
    zs = [0.0]
    for k in range(1, nz + 1):
        zs.append(r * (1 - math.cos(math.pi / 2 * k / nz)))
    zs += [h - z for z in reversed(zs[:-1])]
    for z in zs:
        d = max(0.0, abs(z - h / 2) - (h / 2 - r))
        shrink = r - math.sqrt(max(0.0, r * r - d * d))
        prof.append((A - shrink, B - shrink, z))
    prof.append((0, 0, h))
    return superlathe(prof, n=n, exp=exp)


def translate(mesh, dx=0, dy=0, dz=0):
    v, f = mesh
    return v + np.array([dx, dy, dz], float), f


def rotate(mesh, R):
    v, f = mesh
    return v @ np.asarray(R, float).T, f


RX90 = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]      # Z -> -Y ... (gira 90 em X)
RXm90 = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
RY90 = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]


# ---------------------------------------------------------------------------
# Cores
# ---------------------------------------------------------------------------
BRANCO = (245, 245, 243)
VERMELHO = (205, 35, 45)
AZUL = (30, 90, 180)
AZUL_CLARO = (150, 200, 235)
VERDE_AGUA = (70, 170, 160)
ROSA = (225, 120, 160)
ROXO = (120, 80, 170)
CREME = (240, 228, 200)
BEGE_CURATIVO = (214, 178, 140)
PAPELAO = gb.PAPELAO
PRATA = (200, 202, 206)
CINZA_ESCURO = (60, 60, 64)
GEL = (190, 225, 245)
PET = (225, 235, 245)
VERDE = (60, 150, 90)
AMARELO = (240, 200, 60)


def P(name, mat, rgb, meshes, alpha=1.0):
    return gb.part(name, mat, rgb, meshes, alpha=alpha)


# ---------------------------------------------------------------------------
# Itens
# ---------------------------------------------------------------------------
def caixa_creme_dental():
    W, D, H = 38.0, 28.0, 165.0
    return {"name": "Creme dental - caixa", "parts": [
        P("caixa", "Cartucho branco", BRANCO, [box(0, W, 0, D, 0, 55), box(0, W, 0, D, 110, H)]),
        P("faixa", "Cartucho vermelho", VERMELHO, [box(0, W, 0, D, 55, 110)]),
    ]}


def tubo_creme_dental():
    cap = superlathe([(0, 0, 0), (8.5, 8.5, 0), (8.5, 8.5, 12), (6, 6, 12)], n=24)
    body = superlathe([(6, 6, 12), (9, 9, 14), (17, 17, 24), (17.5, 17.5, 60), (20, 13, 110),
                       (24, 4, 160), (25, 1.5, 168), (0, 0, 168)], n=24, exp=2.2)
    return {"name": "Creme dental - tubo", "parts": [
        P("tampa", "Plastico branco", BRANCO, [cap]),
        P("tubo", "Tubo azul claro", AZUL_CLARO, [body]),
    ]}


def escova_meshes():
    handle = superlathe([(0, 0, 0), (4.5, 2.2, 0), (6.5, 3.2, 25), (7, 3.6, 90), (5.5, 3.2, 125),
                         (3.2, 2.6, 150), (5.8, 2.2, 160), (6.3, 2.2, 186), (4.5, 2.0, 191), (0, 0, 192)],
                        n=20, exp=3.0)
    tufts = []
    for row in range(3):
        for col in range(7):
            x0 = -8.5 + col * 2.8
            y0 = 2.2
            z0 = 163 + row * 7.5
            tufts.append(box(x0, x0 + 1.9, y0, y0 + 10, z0, z0 + 5.5))
    return handle, tufts


def escova_dental():
    handle, tufts = escova_meshes()
    blue = [t for i, t in enumerate(tufts) if i % 7 in (0, 6)]
    white = [t for i, t in enumerate(tufts) if i % 7 not in (0, 6)]
    return {"name": "Escova dental", "parts": [
        P("cabo", "Plastico verde", VERDE, [handle]),
        P("cerdas", "Cerdas brancas", BRANCO, white),
        P("cerdas_cor", "Cerdas azuis", AZUL, blue),
    ]}


def escova_embalagem():
    handle, tufts = escova_meshes()
    cw, ch, ct = 62.0, 228.0, 0.8
    card = box(-cw / 2, cw / 2, 0, ct, 0, ch)
    # bolha na frente da cartela (lado -Y), escova dentro
    bub = superlathe([(0, 0, 8), (9, 7, 8), (12, 11, 14), (12, 11, 210), (9, 7, 216), (0, 0, 216)], n=20, exp=3)
    bub = translate(bub, 0, -11, 0)
    hv, hf = translate(handle, 0, -8, 12)
    tufts_t = [translate(t, 0, -8, 12) for t in tufts]
    hole = gb.lathe([(4, 0), (4, ct), (3, ct), (3, 0)], n=10)
    hole = rotate(hole, RXm90)
    hole = translate(hole, 0, 0, ch - 8)
    return {"name": "Escova dental - embalagem", "parts": [
        P("cartela", "Cartela escova", AZUL_CLARO, [card, hole]),
        P("cabo", "Plastico verde", VERDE, [(hv, hf)]),
        P("cerdas", "Cerdas brancas", BRANCO, tufts_t),
        P("bolha", "PET transparente", PET, [bub], alpha=0.3),
    ]}


def sabonete():
    return {"name": "Sabonete - barra", "parts": [
        P("sabonete", "Sabonete creme", CREME, [rounded_block(45, 30, 25, 9, exp=3.0)])]}


def caixa_sabonete():
    W, D, H = 95.0, 65.0, 30.0
    return {"name": "Sabonete - caixa", "parts": [
        P("caixa", "Cartucho verde", VERDE_AGUA, [box(0, 30, 0, D, 0, H), box(65, W, 0, D, 0, H)]),
        P("faixa", "Cartucho branco", BRANCO, [box(30, 65, 0, D, 0, H)]),
    ]}


def frasco(name, cor_nome, cor, cap_rgb):
    body = superlathe([(0, 0, 0), (27, 17, 0), (32, 21, 6), (33, 22, 125), (31, 20, 150), (22, 15, 162),
                       (14, 14, 166)], n=28, exp=2.4)
    cap = superlathe([(14, 14, 166), (16, 16, 166), (16, 16, 186), (13, 13, 190), (0, 0, 190)], n=28, exp=2.4)
    return {"name": name, "parts": [
        P("frasco", cor_nome, cor, [body]),
        P("tampa", "Tampa branca", cap_rgb, [cap]),
    ]}


def shampoo():
    return frasco("Shampoo 350ml", "Frasco verde-agua", VERDE_AGUA, BRANCO)


def condicionador():
    return frasco("Condicionador 350ml", "Frasco rosa", ROSA, BRANCO)


def desodorante_aerosol():
    can = gb.lathe([(0, 0), (22, 0), (26, 3), (26, 128), (24, 136), (15, 142), (0, 142)], n=28, closed=False)
    cap = gb.lathe([(0, 142), (26.5, 142), (26.5, 182), (22, 186), (0, 186)], n=28, closed=False)
    return {"name": "Desodorante aerosol", "parts": [
        P("lata", "Lata prata", PRATA, [can]),
        P("tampa", "Tampa azul", AZUL, [cap]),
    ]}


def desodorante_rollon():
    body = superlathe([(0, 0, 0), (19, 14, 0), (23, 17, 8), (23, 17, 78), (20, 14, 94), (12, 12, 100)], n=24)
    cap = superlathe([(12, 12, 100), (22, 16, 100), (22, 16, 124), (17, 12, 136), (0, 0, 140)], n=24)
    return {"name": "Desodorante roll-on", "parts": [
        P("frasco", "Plastico branco", BRANCO, [body]),
        P("tampa", "Tampa roxa", ROXO, [cap]),
    ]}


def absorventes():
    return {"name": "Absorventes - pacote", "parts": [
        P("pacote", "Pacote rosa", ROSA, [rounded_block(62, 40, 70, 16, exp=4.0)]),
        P("faixa", "Pacote branco", BRANCO, [translate(rounded_block(62.3, 40.3, 14, 5, exp=4.0), 0, 0, 28)]),
    ]}


def caixa_curativos():
    W, D, H = 95.0, 22.0, 60.0
    return {"name": "Curativos - caixa", "parts": [
        P("caixa", "Cartucho bege", BEGE_CURATIVO, [box(0, W, 0, D, 0, 40), box(0, W, 0, D, 50, H)]),
        P("faixa", "Cartucho vermelho", VERMELHO, [box(0, W, 0, D, 40, 50)]),
    ]}


def curativo():
    strip = superlathe([(0, 0, 0), (38, 9.5, 0), (38, 9.5, 0.8), (0, 0, 0.8)], n=32, exp=4.5)
    pad = superlathe([(0, 0, 0.8), (11, 6.5, 0.8), (11, 6.5, 1.5), (0, 0, 1.5)], n=16, exp=4)
    return {"name": "Curativo adesivo", "parts": [
        P("tira", "Curativo bege", BEGE_CURATIVO, [strip]),
        P("gaze", "Gaze branca", BRANCO, [pad]),
    ]}


def algodao():
    return {"name": "Algodao - pacote", "parts": [
        P("pacote", "Pacote algodao", BRANCO, [rounded_block(60, 35, 55, 14, exp=4.0)]),
        P("faixa", "Faixa azul", AZUL, [translate(rounded_block(60.3, 35.3, 10, 4, exp=4.0), 0, 0, 22)]),
    ]}


def alcool_gel():
    body = gb.lathe([(0, 0), (31, 0), (35, 5), (35, 110), (33, 124), (22, 134), (14, 136), (14, 150), (0, 150)],
                    n=28, closed=False)
    pump = gb.lathe([(0, 150), (15, 150), (15, 164), (5, 164), (5, 182), (0, 182)], n=20, closed=False)
    head = gb.lathe([(0, 182), (11, 182), (11, 196), (0, 196)], n=20, closed=False)
    spout = box(0, 32, -5, 5, 186, 196)
    spout2 = box(26, 32, -5, 5, 180, 186)
    return {"name": "Alcool em gel 500ml", "parts": [
        P("frasco", "Gel transparente", GEL, [body], alpha=0.65),
        P("pump", "Plastico branco", BRANCO, [pump, head, spout, spout2]),
    ]}


def rolo_meshes():
    paper = gb.lathe([(55, 0), (55, 100), (22, 100), (22, 0)], n=40)
    core = gb.lathe([(22, 0), (22, 100), (20, 100), (20, 0)], n=40)
    return paper, core


def papel_higienico():
    paper, core = rolo_meshes()
    return {"name": "Papel higienico - rolo", "parts": [
        P("papel", "Papel branco", BRANCO, [paper]),
        P("tubete", "Papelao", PAPELAO, [core]),
    ]}


def papel_higienico_fardo():
    paper, core = rolo_meshes()
    papers, cores = [], []
    for ix in range(2):
        for iy in range(2):
            dx, dy = 56 + ix * 111, 56 + iy * 111
            papers.append(translate(paper, dx, dy, 2))
            cores.append(translate(core, dx, dy, 2))
    wrap = rounded_block(112, 112, 106, 6, exp=5.0, n=40)
    wrap = translate(wrap, 111.5, 111.5, 0)
    label = translate(rounded_block(112.3, 112.3, 30, 4, exp=5.0, n=40), 111.5, 111.5, 38)
    return {"name": "Papel higienico - fardo 4 rolos", "parts": [
        P("papel", "Papel branco", BRANCO, papers),
        P("tubete", "Papelao", PAPELAO, cores),
        P("rotulo", "Rotulo verde", VERDE_AGUA, [label]),
        P("plastico", "PET transparente", PET, [wrap], alpha=0.3),
    ]}


def lencos_caixa():
    W, D, H = 220.0, 110.0, 55.0
    body = [box(0, W, 0, D, 0, H)]
    oval = superlathe([(0, 0, H), (45, 20, H), (45, 20, H + 0.3), (0, 0, H + 0.3)], n=24)
    oval = translate(oval, W / 2, D / 2, 0)
    # lenço saindo da abertura: folha dobrada em dois painéis finos
    def slab(pts, t=0.4):
        mb = gb.MeshBuilder()
        P_ = np.array([(x + W / 2, y + D / 2, z) for (x, y, z) in pts], float)
        nrm = np.cross(P_[1] - P_[0], P_[3] - P_[0]); nrm /= np.linalg.norm(nrm)
        a = [mb.add_vertex(q) for q in P_]
        b = [mb.add_vertex(q + nrm * t) for q in P_]
        mb.add_quad(a[3], a[2], a[1], a[0])
        mb.add_quad(*b)
        for i in range(4):
            j = (i + 1) % 4
            mb.add_quad(a[i], a[j], b[j], b[i])
        return mb.result()
    sheet1 = slab([(-30, -2, H), (30, -2, H), (34, 6, H + 38), (-26, 6, H + 38)])
    sheet2 = slab([(-26, 6, H + 38), (34, 6, H + 38), (30, 16, H + 12), (-30, 16, H + 12)])
    return {"name": "Lencos de papel - caixa", "parts": [
        P("caixa", "Caixa lencos azul", AZUL_CLARO, body),
        P("abertura", "Abertura escura", CINZA_ESCURO, [oval]),
        P("lenco", "Papel branco", BRANCO, [sheet1, sheet2]),
    ]}


def lencos_bolso():
    return {"name": "Lencos de papel - bolso", "parts": [
        P("pacote", "Pacote lencos", BRANCO, [rounded_block(52, 27, 24, 5, exp=5.0)]),
        P("faixa", "Faixa azul", AZUL, [translate(rounded_block(52.3, 27.3, 6, 2.5, exp=5.0), 0, 0, 9)]),
    ]}


ITEMS = [caixa_creme_dental, tubo_creme_dental, escova_dental, escova_embalagem, sabonete, caixa_sabonete,
         shampoo, condicionador, desodorante_aerosol, desodorante_rollon, absorventes, caixa_curativos,
         curativo, algodao, alcool_gel, papel_higienico, papel_higienico_fardo, lencos_caixa, lencos_bolso]


def render_preview(path, items):
    import render_zbuf as rz
    imgs, titles = [], []
    for it in items:
        parts = [(p["rgb"], p["alpha"], p["mesh"].vertices, p["mesh"].faces) for p in it["parts"]]
        imgs.append(rz.render(parts, width=400, height=360, azim=-125, elev=24))
        V = np.vstack([p["mesh"].vertices for p in it["parts"]])
        s = V.max(0) - V.min(0)
        titles.append(f"{it['name']}  ({s[0]:.0f} x {s[1]:.0f} x {s[2]:.0f} mm)")
    rz.sheet(imgs, titles, 5, path, subtitle="Itens de saude e higiene para a gondola. Milimetros, Z para cima. DAE, OBJ, STL e script Ruby.")


def main():
    items = [fn() for fn in ITEMS]
    layout, x = [], 0.0
    for it in items:
        V = np.vstack([p["mesh"].vertices for p in it["parts"]])
        x += -V[:, 0].min()
        layout.append((x, -V[:, 1].min(), -V[:, 2].min()))
        x += V[:, 0].max() + 40.0
    for d in ("dae", "obj", "stl", "sketchup-ruby"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    for it in items:
        s = gb.slug(it["name"])
        gb.write_dae(os.path.join(OUT, "dae", s + ".dae"), [it], [(0, 0, 0)])
        gb.write_obj(os.path.join(OUT, "obj", s + ".obj"), [it], [(0, 0, 0)])
        gb.write_stl(os.path.join(OUT, "stl", s + ".stl"), it)
    gb.write_dae(os.path.join(OUT, "dae", "todos_os_itens_higiene.dae"), items, layout)
    gb.write_obj(os.path.join(OUT, "obj", "todos_os_itens_higiene.obj"), items, layout)
    gb.write_ruby(os.path.join(OUT, "sketchup-ruby", "itens_higiene.rb"), items, layout, module_name="MK4U_Higiene")
    render_preview(os.path.join(OUT, "preview_higiene.png"), items)
    for it in items:
        n = sum(len(p["mesh"].faces) for p in it["parts"])
        ok = all(p["mesh"].is_winding_consistent for p in it["parts"])
        print(f"{it['name']:34s} tris={n:6d} winding_ok={ok}")
    zpath = os.path.join(OUT, "itens_higiene_sketchup.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for d in ("dae", "obj", "stl", "sketchup-ruby"):
            for f in sorted(os.listdir(os.path.join(OUT, d))):
                zf.write(os.path.join(OUT, d, f), os.path.join(d, f))
        for f in ("preview_higiene.png", "README.md"):
            fp = os.path.join(OUT, f)
            if os.path.exists(fp):
                zf.write(fp, f)
    print("zip:", zpath)


if __name__ == "__main__":
    main()
