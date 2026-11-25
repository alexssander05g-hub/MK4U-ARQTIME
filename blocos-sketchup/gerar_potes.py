#!/usr/bin/env python3
"""
Gera caixas bin (abertas na frente) cheias de ferragens para SketchUp:
parafusos, pregos, pacotes de pregos (blister), arruelas, porcas, buchas
e uma mista. Saída em potes/ (DAE, OBJ, script Ruby, preview).

Os itens do monte são versões leves (poucos polígonos) usadas como
COMPONENTES instanciados, sobre uma superfície "monte" que simula a massa
de peças por baixo. Assim cada bin pesa pouco no SketchUp.

Rode:  python3 gerar_potes.py
"""
import math
import os
import zipfile
from datetime import datetime, timezone

import numpy as np
import trimesh

import gerar_blocos as gb

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "potes")
TAU = math.tau
rng = np.random.default_rng(2025)

# ---------------------------------------------------------------------------
# Caixa bin: ajuste aqui as medidas (mm). W = largura, D = profundidade, H = altura
# ---------------------------------------------------------------------------
BIN = dict(W=140.0, D=230.0, H=125.0, Hf=55.0, slope_start=0.42, t=2.5)
FILL_Z = 44.0   # altura média do monte (a partir do chão da caixa)

PLASTICO_BIN = (38, 38, 40)
PAPEL_BLISTER = (236, 228, 200)
PET_CLARO = (220, 235, 245)


def extrude_polygon_x(poly_yz, x0, x1):
    """Extruda um polígono (lista de (y,z), anti-horário) ao longo de X."""
    mb = gb.MeshBuilder()
    n = len(poly_yz)
    a = [mb.add_vertex((x0, y, z)) for (y, z) in poly_yz]
    b = [mb.add_vertex((x1, y, z)) for (y, z) in poly_yz]
    # tampa em x0 (normal -x): polígono anti-horário visto de +x => inverter
    for k in range(1, n - 1):
        mb.add_tri(a[0], a[k + 1], a[k])
        mb.add_tri(b[0], b[k], b[k + 1])
    for i in range(n):
        j = (i + 1) % n
        mb.add_quad(a[i], a[j], b[j], b[i])
    return mb.result()


def box(x0, x1, y0, y1, z0, z1):
    return extrude_polygon_x([(y0, z0), (y1, z0), (y1, z1), (y0, z1)], x0, x1)


def caixa_bin():
    W, D, H, Hf, t = BIN["W"], BIN["D"], BIN["H"], BIN["Hf"], BIN["t"]
    ys = BIN["slope_start"] * D
    side = [(0, 0), (D, 0), (D, H), (ys, H), (0, Hf)]
    meshes = [
        extrude_polygon_x(side, 0, t),
        extrude_polygon_x(side, W - t, W),
        box(t, W - t, 0, t, 0, Hf),            # frente (baixa)
        box(t, W - t, D - t, D, 0, H),         # fundo
        box(t, W - t, t, D - t, 0, t),         # chão
        box(0, W, D - t - 6, D, H - 4, H),     # reforço/gancho traseiro
        box(0, W, 0, t + 5, Hf - 4, Hf),       # lábio frontal
    ]
    return [gb.part("caixa", "Plastico bin", PLASTICO_BIN, meshes)]


# ---------------------------------------------------------------------------
# Itens leves
# ---------------------------------------------------------------------------
def parafuso_lite():
    prof = [(0, 0), (0.6, 1.8)]
    z = 2.4
    while z < 28.5:
        prof.append((1.45, z))
        prof.append((2.0, z + 1.2))
        z += 2.4
    prof += [(1.6, 29.5), (1.6, 37.6), (4.0, 40.0), (0, 40.0)]
    return [gb.part("parafuso", "Zinco amarelo", gb.ZINCO_AMARELO, [gb.lathe(prof, n=8, closed=False)])]


def prego_lite():
    prof = [(0, 0), (1.5, 8), (1.5, 60.7), (3.3, 60.7), (3.3, 61.6), (2.4, 62), (0, 62)]
    return [gb.part("prego", "Aco escuro", gb.ACO_ESCURO, [gb.lathe(prof, n=6, closed=False)])]


def arruela_lite():
    return [gb.part("arruela", "Zinco", gb.ZINCO, [gb.lathe([(6.25, 0), (6.25, 1.6), (3.2, 1.6), (3.2, 0)], n=12)])]


def porca_lite():
    thetas = sorted({math.pi / 6 + k * math.pi / 3 for k in range(6)} | {k * math.pi / 3 for k in range(6)})
    r_out = [5.0 / math.cos(t - round(t / (math.pi / 3)) * math.pi / 3) for t in thetas]
    return [gb.part("porca", "Zinco", gb.ZINCO, [gb.polar_prism(thetas, r_out, [2.6] * len(thetas), 0, 5)])]


def bucha_lite():
    prof = [(2.0, 0), (2.4, 0), (3.0, 2.5), (3.0, 28.5), (3.9, 28.5), (3.9, 30), (2.0, 30)]
    return [gb.part("bucha", "Nylon", gb.NYLON, [gb.lathe(prof, n=8)])]


def blister_pregos():
    """Cartela 70 x 110 mm (eixo Z = altura da cartela, Y = espessura)
    com bolha transparente e 12 pregos dentro."""
    cw, ch, ct = 62.0, 95.0, 0.8
    card = box(-cw / 2, cw / 2, 0, ct, 0, ch)
    bw, bh, bd = 50.0, 66.0, 9.0
    bx0, bz0 = -bw / 2, 8.0
    bubble = box(bx0, bx0 + bw, ct, ct + bd, bz0, bz0 + bh)
    # furo de pendurar simplificado: pequeno anel no topo
    hole = gb.lathe([(4.0, 0), (4.0, ct), (3.0, ct), (3.0, 0)], n=10)
    hole_v, hole_f = hole
    rot = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)  # Z -> Y
    hole_v = hole_v @ rot.T + np.array([0, 0, ch - 8])
    nails = []
    nv, nf = gb.lathe([(0, 0), (1.5, 8), (1.5, 60.7), (3.3, 60.7), (3.3, 61.6), (2.4, 62), (0, 62)], n=6, closed=False)
    for k in range(12):
        col, row = k % 6, k // 6
        x = bx0 + 5 + col * 8.0 + rng.uniform(-0.6, 0.6)
        y = ct + 2.5 + row * 3.5
        v = nv.copy()
        v[:, 2] += bz0 + 8 + rng.uniform(-2, 2)
        v[:, 0] += x
        v[:, 1] += y
        nails.append((v, nf))
    return [
        gb.part("cartela", "Papel blister", PAPEL_BLISTER, [card]),
        gb.part("bolha", "PET transparente", PET_CLARO, [bubble], alpha=0.35),
        gb.part("pregos", "Aco escuro", gb.ACO_ESCURO, nails),
    ]


# ---------------------------------------------------------------------------
# Monte (superfície da massa de peças) e colocação dos itens
# ---------------------------------------------------------------------------
class Mound:
    def __init__(self, base_z, amp=6.0, nb=5):
        W, D, t = BIN["W"], BIN["D"], BIN["t"]
        self.x0, self.x1, self.y0, self.y1 = t, W - t, t, D - t
        self.base = base_z
        self.bumps = [(rng.uniform(self.x0 + 20, self.x1 - 20), rng.uniform(self.y0 + 20, self.y1 - 20),
                       rng.uniform(25, 60), rng.uniform(-amp, amp)) for _ in range(nb)]

    def h(self, x, y):
        z = self.base
        for (bx, by, s, a) in self.bumps:
            z += a * math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * s * s))
        # levemente mais baixo na frente (as peças "escorrem" para a boca)
        z -= 4.0 * (1 - (y - self.y0) / (self.y1 - self.y0)) ** 2
        return z

    def normal(self, x, y, eps=1.0):
        dx = (self.h(x + eps, y) - self.h(x - eps, y)) / (2 * eps)
        dy = (self.h(x, y + eps) - self.h(x, y - eps)) / (2 * eps)
        n = np.array([-dx, -dy, 1.0])
        return n / np.linalg.norm(n)

    def mesh(self, nx=14, ny=22):
        mb = gb.MeshBuilder()
        top = [[mb.add_vertex((self.x0 + (self.x1 - self.x0) * i / nx,
                               self.y0 + (self.y1 - self.y0) * j / ny,
                               self.h(self.x0 + (self.x1 - self.x0) * i / nx,
                                      self.y0 + (self.y1 - self.y0) * j / ny)))
                for j in range(ny + 1)] for i in range(nx + 1)]
        bot = [[mb.add_vertex((self.x0 + (self.x1 - self.x0) * i / nx,
                               self.y0 + (self.y1 - self.y0) * j / ny, BIN["t"]))
                for j in range(ny + 1)] for i in range(nx + 1)]
        for i in range(nx):
            for j in range(ny):
                mb.add_quad(top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1])
                mb.add_quad(bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j])
        for i in range(nx):   # laterais y0 e y1
            mb.add_quad(bot[i][0], bot[i + 1][0], top[i + 1][0], top[i][0])
            mb.add_quad(bot[i + 1][ny], bot[i][ny], top[i][ny], top[i + 1][ny])
        for j in range(ny):   # laterais x0 e x1
            mb.add_quad(bot[0][j + 1], bot[0][j], top[0][j], top[0][j + 1])
            mb.add_quad(bot[nx][j], bot[nx][j + 1], top[nx][j + 1], top[nx][j])
        return mb.result()


def frame(origin, zaxis, spin=None):
    """Matriz 4x4 que leva o item (eixo Z local) para zaxis em origin."""
    z = np.asarray(zaxis, float)
    z /= np.linalg.norm(z)
    ref = np.array([1.0, 0, 0]) if abs(z[0]) < 0.9 else np.array([0, 1.0, 0])
    x = np.cross(ref, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    if spin is None:
        spin = rng.uniform(0, TAU)
    c, s = math.cos(spin), math.sin(spin)
    x, y = c * x + s * y, -s * x + c * y
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, z, origin
    return M


def tilt(n, max_deg):
    a = math.radians(rng.uniform(0, max_deg))
    phi = rng.uniform(0, TAU)
    ref = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(ref, n)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    d = n * math.cos(a) + (u * math.cos(phi) + v * math.sin(phi)) * math.sin(a)
    return d / np.linalg.norm(d)


def scatter(mound, count, kind, length, margin, sink):
    """Devolve lista de matrizes 4x4.
    kind='lying': eixo Z do item deitado no plano do monte (parafuso, prego)
    kind='flat' : eixo Z do item alinhado à normal (arruela, porca)."""
    mats = []
    for _ in range(count):
        x = rng.uniform(mound.x0 + margin, mound.x1 - margin)
        y = rng.uniform(mound.y0 + margin, mound.y1 - margin)
        n = tilt(mound.normal(x, y), 12)
        z = mound.h(x, y) - sink
        if kind == "lying":
            phi = rng.uniform(0, TAU)
            d = np.array([math.cos(phi), math.sin(phi), 0.0])
            d -= n * (d @ n)
            d /= np.linalg.norm(d)
            d = tilt(d, 20)
            origin = np.array([x, y, z]) - d * (length / 2)
            mats.append(frame(origin, d))
        else:
            if rng.uniform() < 0.5:   # metade virada para baixo (sem diferença visual)
                n = n
            mats.append(frame(np.array([x, y, z]), n))
    return mats


# ---------------------------------------------------------------------------
# Cena: definições e compostos
# ---------------------------------------------------------------------------
DEFS = {}
COMPOSITES = []


def define(name, parts):
    DEFS[name] = parts
    return name


def mound_part(name, rgb):
    m = Mound(FILL_Z)
    dark = tuple(int(c * 0.55) for c in rgb)
    define(name, [gb.part("monte", "Massa " + name, dark, [m.mesh()])])
    return m


def bin_cheio(label, fill_name, rgb, item_def, count, kind, length, margin, sink, extra=()):
    m = mound_part("Monte " + fill_name, rgb)
    inst = [("Caixa bin", np.eye(4)), ("Monte " + fill_name, np.eye(4))]
    for M in scatter(m, count, kind, length, margin, sink):
        inst.append((item_def, M))
    for (d, cnt, k, ln, mg, sk) in extra:
        for M in scatter(m, cnt, k, ln, mg, sk):
            inst.append((d, M))
    COMPOSITES.append({"name": label, "instances": inst})


def bin_blister():
    m = mound_part("Monte pacotes de pregos", PAPEL_BLISTER)
    inst = [("Caixa bin", np.eye(4)), ("Monte pacotes de pregos", np.eye(4))]
    W, D, t = BIN["W"], BIN["D"], BIN["t"]
    # pacotes em pé, encostados uns nos outros, inclinados para trás
    ch = 95.0
    lean = math.radians(18)
    # o pacote mais ao fundo encosta o topo na parede traseira
    y = D - t - 2 - ch * math.sin(lean)
    for k in range(7):
        ln = lean + math.radians(rng.uniform(-2, 2))
        zb = m.h(W / 2, y) - 14
        M = np.eye(4)
        c, s_ = math.cos(ln), math.sin(ln)
        M[:3, 0] = [-1, 0, 0]
        M[:3, 1] = [0, -c, s_]          # bolha (Y local) virada para a frente
        M[:3, 2] = [0, s_, c]           # altura (Z local) inclina para +Y
        M[:3, 3] = [W / 2 + rng.uniform(-3, 3), y, zb]
        inst.append(("Pacote de pregos (blister)", M))
        y -= 15
    # dois pacotes deitados na frente, altura da cartela ao longo de +Y
    for k in range(2):
        x, yy = W / 2 + rng.uniform(-6, 6), 30 + k * 12
        n = tilt(m.normal(x, yy), 6)
        zc = np.array([0.0, 1.0, 0.0]) - n * n[1]
        zc /= np.linalg.norm(zc)
        xc = np.cross(n, zc)
        M = np.eye(4)
        M[:3, 0], M[:3, 1], M[:3, 2] = xc, n, zc
        M[:3, 3] = [x, yy, m.h(x, yy) - 1.5 + k * 1.2]
        inst.append(("Pacote de pregos (blister)", M))
    COMPOSITES.append({"name": "Bin - pacotes de pregos", "instances": inst})


def mound_part_h(m, x, y):
    return m.h(x, y)


def build_scene():
    define("Caixa bin", caixa_bin())
    define("Parafuso 4x40 (lite)", parafuso_lite())
    define("Prego 17x27 (lite)", prego_lite())
    define("Arruela M6 (lite)", arruela_lite())
    define("Porca M6 (lite)", porca_lite())
    define("Bucha 6mm (lite)", bucha_lite())
    define("Pacote de pregos (blister)", blister_pregos())

    bin_cheio("Bin - parafusos", "parafusos", gb.ZINCO_AMARELO, "Parafuso 4x40 (lite)", 150, "lying", 40, 18, 1.2)
    bin_cheio("Bin - pregos", "pregos", gb.ACO_ESCURO, "Prego 17x27 (lite)", 230, "lying", 62, 28, 0.8)
    bin_blister()
    bin_cheio("Bin - arruelas", "arruelas", gb.ZINCO, "Arruela M6 (lite)", 340, "flat", 1.6, 7, 0.6)
    bin_cheio("Bin - porcas", "porcas", gb.ZINCO, "Porca M6 (lite)", 240, "flat", 5, 7, 2.0)
    bin_cheio("Bin - buchas", "buchas", gb.NYLON, "Bucha 6mm (lite)", 170, "lying", 30, 14, 1.5)
    bin_cheio("Bin - ferragens mistas", "ferragens mistas", gb.ZINCO, "Parafuso 4x40 (lite)", 70, "lying", 40, 18, 1.2,
              extra=[("Porca M6 (lite)", 90, "flat", 5, 7, 2.0), ("Arruela M6 (lite)", 120, "flat", 1.6, 7, 0.6)])


# ---------------------------------------------------------------------------
# Exportadores com instâncias
# ---------------------------------------------------------------------------
def slug(s):
    return gb.slug(s)


def fmt(x):
    return gb.fmt(x)


def all_materials(defs):
    mats = {}
    for parts in defs.values():
        for p in parts:
            mats[p["material"]] = (p["rgb"], p["alpha"])
    return mats


def write_dae(path, composites, layout):
    used = sorted({d for c in composites for (d, _) in c["instances"]})
    defs = {k: DEFS[k] for k in used}
    mats = all_materials(defs)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    L = ['<?xml version="1.0" encoding="utf-8"?>',
         '<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">',
         '<asset><contributor><authoring_tool>gerar_potes.py</authoring_tool></contributor>'
         f'<created>{now}</created><modified>{now}</modified>'
         '<unit name="millimeter" meter="0.001"/><up_axis>Z_UP</up_axis></asset>',
         '<library_effects>']
    for name, (rgb, alpha) in mats.items():
        mid = "mat_" + slug(name)
        r, g, b = [c / 255 for c in rgb]
        L.append(f'<effect id="{mid}_fx"><profile_COMMON><technique sid="common"><lambert>'
                 f'<diffuse><color>{r:.4f} {g:.4f} {b:.4f} 1</color></diffuse>'
                 f'<transparent opaque="A_ONE"><color>1 1 1 {alpha}</color></transparent><transparency><float>1</float></transparency>'
                 '</lambert></technique></profile_COMMON></effect>')
    L.append('</library_effects><library_materials>')
    for name in mats:
        mid = "mat_" + slug(name)
        L.append(f'<material id="{mid}" name="{name}"><instance_effect url="#{mid}_fx"/></material>')
    L.append('</library_materials><library_geometries>')
    geom_of_def = {}
    for dname, parts in defs.items():
        geom_of_def[dname] = []
        for pi, p in enumerate(parts):
            m = trimesh.graph.smooth_shade(p["mesh"], angle=math.radians(35))
            gid = f"g_{slug(dname)}_{pi}"
            mid = "mat_" + slug(p["material"])
            V, N, F = m.vertices, m.vertex_normals, m.faces
            pos = " ".join(fmt(x) for x in V.ravel())
            nrm = " ".join("%.3f" % x for x in N.ravel())
            L.append(f'<geometry id="{gid}" name="{slug(p["name"])}"><mesh>')
            L.append(f'<source id="{gid}_pos"><float_array id="{gid}_pos_arr" count="{V.size}">{pos}</float_array>'
                     f'<technique_common><accessor source="#{gid}_pos_arr" count="{len(V)}" stride="3">'
                     '<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>'
                     '</accessor></technique_common></source>')
            L.append(f'<source id="{gid}_nrm"><float_array id="{gid}_nrm_arr" count="{N.size}">{nrm}</float_array>'
                     f'<technique_common><accessor source="#{gid}_nrm_arr" count="{len(N)}" stride="3">'
                     '<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>'
                     '</accessor></technique_common></source>')
            L.append(f'<vertices id="{gid}_vtx"><input semantic="POSITION" source="#{gid}_pos"/></vertices>')
            pidx = " ".join(f"{a} {a}" for a in F.ravel())
            L.append(f'<triangles material="{mid}_sym" count="{len(F)}">'
                     f'<input semantic="VERTEX" source="#{gid}_vtx" offset="0"/>'
                     f'<input semantic="NORMAL" source="#{gid}_nrm" offset="1"/><p>{pidx}</p></triangles>')
            L.append('</mesh></geometry>')
            geom_of_def[dname].append((gid, mid))
    L.append('</library_geometries><library_nodes>')
    for dname in defs:
        L.append(f'<node id="lib_{slug(dname)}" name="{dname}" type="NODE">')
        for gid, mid in geom_of_def[dname]:
            L.append(f'<instance_geometry url="#{gid}"><bind_material><technique_common>'
                     f'<instance_material symbol="{mid}_sym" target="#{mid}"/>'
                     '</technique_common></bind_material></instance_geometry>')
        L.append('</node>')
    L.append('</library_nodes><library_visual_scenes><visual_scene id="scene" name="scene">')
    for ci, comp in enumerate(composites):
        x, y, z = layout[ci]
        L.append(f'<node id="comp{ci}" name="{comp["name"]}" type="NODE"><translate>{fmt(x)} {fmt(y)} {fmt(z)}</translate>')
        for k, (dname, M) in enumerate(comp["instances"]):
            mat = " ".join(fmt(v) for v in M.ravel())
            L.append(f'<node id="comp{ci}_i{k}" name="{dname}" type="NODE"><matrix>{mat}</matrix>'
                     f'<instance_node url="#lib_{slug(dname)}"/></node>')
        L.append('</node>')
    L.append('</visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene></COLLADA>')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))


def baked(comp, offset=(0, 0, 0)):
    """Lista de (material, rgb, alpha, mesh) com todas as instâncias aplicadas."""
    out = []
    for dname, M in comp["instances"]:
        for p in DEFS[dname]:
            m = p["mesh"].copy()
            m.apply_transform(M)
            m.apply_translation(offset)
            out.append((p["material"], p["rgb"], p["alpha"], m))
    return out


def write_obj(path, composites, layout):
    mtl_path = os.path.splitext(path)[0] + ".mtl"
    mats = all_materials(DEFS)
    with open(mtl_path, "w", encoding="utf-8") as fh:
        for name, (rgb, alpha) in mats.items():
            r, g, b = [c / 255 for c in rgb]
            fh.write(f"newmtl {slug(name)}\nKd {r:.4f} {g:.4f} {b:.4f}\nKa 0 0 0\nKs 0.1 0.1 0.1\nNs 20\nd {alpha}\n\n")
    off = 1
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("# Bins com ferragens - milimetros, Z para cima\n")
        fh.write(f"mtllib {os.path.basename(mtl_path)}\n")
        for ci, comp in enumerate(composites):
            fh.write(f"o {slug(comp['name'])}\n")
            # agrupa por material para reduzir trocas
            by_mat = {}
            for (mat, rgb, alpha, m) in baked(comp, layout[ci]):
                by_mat.setdefault(mat, []).append(m)
            for mat, ms in by_mat.items():
                m = trimesh.util.concatenate(ms)
                fh.write(f"g {slug(comp['name'])}_{slug(mat)}\nusemtl {slug(mat)}\n")
                for v in m.vertices:
                    fh.write(f"v {fmt(v[0])} {fmt(v[1])} {fmt(v[2])}\n")
                for f in m.faces:
                    fh.write(f"f {f[0] + off} {f[1] + off} {f[2] + off}\n")
                off += len(m.vertices)


def write_ruby(path, composites, layout):
    L = ["# encoding: UTF-8",
         "# Caixas bin cheias de ferragens para SketchUp (gerado por gerar_potes.py)",
         "# Como usar: Janela > Console Ruby e cole:",
         '#   load "C:/caminho/para/bins_ferragens.rb"',
         "# Cria componentes: a caixa bin, os itens leves e um componente por bin cheio.",
         "require 'sketchup.rb'",
         "module MK4U_Bins",
         "  SMOOTH = Geom::PolygonMesh::AUTO_SOFTEN | Geom::PolygonMesh::SMOOTH_SOFT_EDGES",
         "  DEFS = {"]
    for dname, parts in DEFS.items():
        L.append(f"    {dname!r} => [")
        for p in parts:
            m = p["mesh"]
            r, g, b = p["rgb"]
            pts = ",".join(f"[{fmt(v[0])},{fmt(v[1])},{fmt(v[2])}]" for v in m.vertices)
            tris = ",".join(f"[{f[0]},{f[1]},{f[2]}]" for f in m.faces)
            L.append(f"      {{ material: {p['material']!r}, rgb: [{r},{g},{b}], alpha: {p['alpha']},")
            L.append(f"        pts: [{pts}],")
            L.append(f"        tris: [{tris}] }},")
        L.append("    ],")
    L.append("  }")
    L.append("  COMPOSITES = [")
    for ci, comp in enumerate(composites):
        x, y, z = layout[ci]
        L.append(f"    {{ name: {comp['name']!r}, pos: [{fmt(x)}, {fmt(y)}, {fmt(z)}], instances: [")
        for dname, M in comp["instances"]:
            o = M[:3, 3]
            ax = [",".join(fmt(v) for v in M[:3, k]) for k in range(3)]
            L.append(f"      [{dname!r}, [{fmt(o[0])},{fmt(o[1])},{fmt(o[2])}], [{ax[0]}], [{ax[1]}], [{ax[2]}]],")
        L.append("    ] },")
    L.append("  ]")
    L.append("""
  def self.material(model, name, rgb, alpha)
    m = model.materials[name] || model.materials.add(name)
    m.color = Sketchup::Color.new(rgb[0], rgb[1], rgb[2])
    m.alpha = alpha
    m
  end

  def self.add_part(ents, mat, pts, tris)
    mesh = Geom::PolygonMesh.new(pts.length, tris.length)
    pts.each { |p| mesh.add_point(Geom::Point3d.new(p[0].mm, p[1].mm, p[2].mm)) }
    tris.each { |t| mesh.add_polygon(t[0] + 1, t[1] + 1, t[2] + 1) }
    ents.add_faces_from_mesh(mesh, SMOOTH, mat, mat)
  end

  def self.run
    model = Sketchup.active_model
    model.start_operation('Bins com ferragens', true)
    defs = {}
    DEFS.each do |name, parts|
      d = model.definitions.add(name)
      parts.each do |part|
        mat = material(model, part[:material], part[:rgb], part[:alpha])
        add_part(d.entities, mat, part[:pts], part[:tris])
      end
      defs[name] = d
    end
    COMPOSITES.each do |comp|
      cd = model.definitions.add(comp[:name])
      comp[:instances].each do |(dname, o, xa, ya, za)|
        tr = Geom::Transformation.axes(Geom::Point3d.new(o[0].mm, o[1].mm, o[2].mm),
                                       Geom::Vector3d.new(*xa), Geom::Vector3d.new(*ya), Geom::Vector3d.new(*za))
        cd.entities.add_instance(defs[dname], tr)
      end
      pos = comp[:pos]
      model.active_entities.add_instance(cd, Geom::Transformation.new(Geom::Point3d.new(pos[0].mm, pos[1].mm, pos[2].mm)))
    end
    model.commit_operation
    model.active_view.zoom_extents
    puts "Bins criados: #{COMPOSITES.map { |c| c[:name] }.join(', ')}"
  end
end
MK4U_Bins.run
""")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))


def render_preview(path, composites):
    import render_zbuf as rz
    imgs, titles = [], []
    for comp in composites:
        parts = [(rgb, alpha, m.vertices, m.faces) for (mat, rgb, alpha, m) in baked(comp)]
        imgs.append(rz.render(parts, azim=-62, elev=36))
        ntri = sum(len(f) for (_, _, _, f) in parts)
        titles.append(f"{comp['name']}  ({ntri:,} triangulos)")
    W, D, H = BIN["W"], BIN["D"], BIN["H"]
    rz.sheet(imgs, titles, 4, path,
             subtitle=f"Caixa bin {W:.0f} x {D:.0f} x {H:.0f} mm (L x P x A). Itens do monte sao componentes leves "
                      "instanciados sobre uma base 'monte'. Formatos: DAE, OBJ e script Ruby.")


def main():
    build_scene()
    for d in ("dae", "obj", "sketchup-ruby"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    layout = [(i * (BIN["W"] + 20.0), 0.0, 0.0) for i in range(len(COMPOSITES))]
    for comp in COMPOSITES:
        s = slug(comp["name"])
        write_dae(os.path.join(OUT, "dae", s + ".dae"), [comp], [(0, 0, 0)])
        write_obj(os.path.join(OUT, "obj", s + ".obj"), [comp], [(0, 0, 0)])
    write_dae(os.path.join(OUT, "dae", "todos_os_bins.dae"), COMPOSITES, layout)
    write_obj(os.path.join(OUT, "obj", "todos_os_bins.obj"), COMPOSITES, layout)
    # caixa vazia também, para quem quiser só ela
    empty = {"name": "Caixa bin vazia", "instances": [("Caixa bin", np.eye(4))]}
    write_dae(os.path.join(OUT, "dae", "caixa_bin_vazia.dae"), [empty], [(0, 0, 0)])
    write_obj(os.path.join(OUT, "obj", "caixa_bin_vazia.obj"), [empty], [(0, 0, 0)])
    write_ruby(os.path.join(OUT, "sketchup-ruby", "bins_ferragens.rb"), COMPOSITES + [empty], layout + [(len(COMPOSITES) * (BIN["W"] + 20.0), 0, 0)])
    render_preview(os.path.join(OUT, "preview_bins.png"), COMPOSITES)
    for dname, parts in DEFS.items():
        print(f"{dname:30s} tris={sum(len(p['mesh'].faces) for p in parts):6d}")
    for comp in COMPOSITES:
        n = sum(len(DEFS[d][0]["mesh"].faces) * 0 + sum(len(p["mesh"].faces) for p in DEFS[d]) for d, _ in comp["instances"])
        print(f"{comp['name']:30s} instancias={len(comp['instances']):4d} tris_total={n:7d}")
    zpath = os.path.join(OUT, "bins_ferragens_sketchup.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for d in ("dae", "obj", "sketchup-ruby"):
            for f in sorted(os.listdir(os.path.join(OUT, d))):
                zf.write(os.path.join(OUT, d, f), os.path.join(d, f))
        for f in ("preview_bins.png", "README.md"):
            fp = os.path.join(OUT, f)
            if os.path.exists(fp):
                zf.write(fp, f)
    print("zip:", zpath)


if __name__ == "__main__":
    main()
