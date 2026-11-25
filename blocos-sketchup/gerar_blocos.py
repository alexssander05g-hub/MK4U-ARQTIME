#!/usr/bin/env python3
"""
Gera blocos 3D de ferragens (fita isolante, veda-rosca, prego, parafuso,
bucha, porca, arruela) em formatos que o SketchUp importa:
  - DAE (Collada) com materiais e unidade em milímetros  -> dae/
  - OBJ + MTL                                            -> obj/
  - STL binário (sem cor)                                -> stl/
  - Script Ruby que cria os componentes direto no SketchUp -> sketchup-ruby/
Também gera um preview PNG (preview.png).

Tudo é modelado em milímetros, eixo Z para cima.
Rode:  python3 gerar_blocos.py
"""
import math
import os
import sys
import zipfile
from datetime import datetime, timezone

import numpy as np
import trimesh

OUT = os.path.dirname(os.path.abspath(__file__))
TAU = math.tau


# ----------------------------------------------------------------------------
# Primitivas de malha (todas devolvem (vertices Nx3, faces Mx3) com normais
# apontando para fora quando usadas como descrito).
# ----------------------------------------------------------------------------
class MeshBuilder:
    def __init__(self):
        self.v = []
        self.f = []

    def add_vertex(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def add_tri(self, a, b, c):
        self.f.append((a, b, c))

    def add_quad(self, a, b, c, d):
        # a,b,c,d em ordem anti-horária vista de fora
        self.f.append((a, b, c))
        self.f.append((a, c, d))

    def result(self):
        return np.array(self.v, dtype=float), np.array(self.f, dtype=int)


def lathe(profile, n=48, closed=True, theta0=0.0, theta1=TAU, caps=False, thetas=None):
    """Superfície de revolução.

    profile: lista de (r, z). Para um sólido fechado (anel, tubo) use um laço
    anti-horário no plano (r, z): sobe pela borda externa, atravessa o topo
    para dentro, desce pela borda interna, volta pela base. Para sólidos sem
    furo comece e termine em r=0 (polos) e use closed=False.
    theta0/theta1: faixa angular (para setores). caps=True fecha as faces
    planas nas extremidades angulares de um setor.
    """
    mb = MeshBuilder()
    if thetas is not None:          # lista explícita de ângulos (volta completa)
        n = len(thetas)
        theta0, theta1 = 0.0, TAU
    full = abs((theta1 - theta0) - TAU) < 1e-9
    m = n if full else n + 1
    idx = []
    for k, (r, z) in enumerate(profile):
        ring = []
        if r <= 1e-9:
            i = mb.add_vertex((0.0, 0.0, z))
            ring = [i] * (m)
        else:
            for i in range(m):
                th = thetas[i] if thetas is not None else theta0 + (theta1 - theta0) * i / n
                ring.append(mb.add_vertex((r * math.cos(th), r * math.sin(th), z)))
        idx.append(ring)
    edges = list(zip(range(len(profile)), range(1, len(profile))))
    if closed:
        edges.append((len(profile) - 1, 0))
    for a, b in edges:
        for i in range(n):
            i2 = (i + 1) % m
            mb.add_quad(idx[a][i], idx[a][i2], idx[b][i2], idx[b][i])
    if caps and not full:
        # polígono do perfil em theta0 (normal para -tangente) e theta1 (+tangente)
        for end, flip in ((0, False), (n, True)):
            ring_pts = [idx[k][end] for k in range(len(profile))]
            c = ring_pts[0]
            for k in range(1, len(ring_pts) - 1):
                if flip:
                    mb.add_tri(c, ring_pts[k + 1], ring_pts[k])
                else:
                    mb.add_tri(c, ring_pts[k], ring_pts[k + 1])
    return mb.result()


def polar_prism(thetas, r_out, r_in, z0, z1):
    """Prisma 'polar': raio externo e interno podem variar com o ângulo
    (hexágono, cruz Phillips...). r_in pode ser 0 (sólido)."""
    mb = MeshBuilder()
    n = len(thetas)
    ob = [mb.add_vertex((r_out[i] * math.cos(thetas[i]), r_out[i] * math.sin(thetas[i]), z0)) for i in range(n)]
    ot = [mb.add_vertex((r_out[i] * math.cos(thetas[i]), r_out[i] * math.sin(thetas[i]), z1)) for i in range(n)]
    solid = np.all(np.asarray(r_in) <= 1e-9)
    if solid:
        cb = mb.add_vertex((0, 0, z0))
        ct = mb.add_vertex((0, 0, z1))
    else:
        ib = [mb.add_vertex((r_in[i] * math.cos(thetas[i]), r_in[i] * math.sin(thetas[i]), z0)) for i in range(n)]
        it = [mb.add_vertex((r_in[i] * math.cos(thetas[i]), r_in[i] * math.sin(thetas[i]), z1)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        mb.add_quad(ob[i], ob[j], ot[j], ot[i])            # parede externa
        if solid:
            mb.add_tri(ct, ot[i], ot[j])                    # topo
            mb.add_tri(cb, ob[j], ob[i])                    # base
        else:
            mb.add_quad(ot[i], ot[j], it[j], it[i])        # topo (anel)
            mb.add_quad(it[i], it[j], ib[j], ib[i])        # parede interna
            mb.add_quad(ib[i], ib[j], ob[j], ob[i])        # base (anel)
    return mb.result()


def helical_thread(r_core, r_outer, pitch, z_bot, z_top, n=32, rows_per_pitch=6,
                   tip_len=0.0, crest=0.3):
    """Rosca helicoidal real (grade alinhada com a hélice).
    tip_len: comprimento da ponta cônica a partir de z_bot."""
    mb = MeshBuilder()
    total_rows = int(math.ceil((z_top - z_bot) / pitch * rows_per_pitch)) + 2 * rows_per_pitch + 2
    grid = []
    for j in range(total_rows):
        row = []
        for i in range(n):
            th = TAU * i / n
            z = z_bot - pitch + j * pitch / rows_per_pitch + th / TAU * pitch
            zz = min(max(z, z_bot), z_top)
            # posição no perfil do filete (0..1); acima do topo usa o perfil
            # real em z_top para que o corte fique plano e sem faces sobrepostas
            t = ((zz - z_bot) / pitch - th / TAU) % 1.0
            prof = max(0.0, 1.0 - abs(t - 0.5) / crest)
            r = r_core + (r_outer - r_core) * prof
            if tip_len > 0 and zz - z_bot < tip_len:
                taper = ((zz - z_bot) / tip_len) ** 0.6
                r *= taper
            if zz - z_bot < 0.35:  # polo da ponta
                r = 0.0
                zz = z_bot
            row.append(mb.add_vertex((r * math.cos(th), r * math.sin(th), zz)))
        grid.append(row)
    for j in range(total_rows - rows_per_pitch - 1):
        for i in range(n):
            if i + 1 < n:
                a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            else:
                a, b, c, d = grid[j][i], grid[j + rows_per_pitch][0], grid[j + rows_per_pitch + 1][0], grid[j + 1][i]
            mb.add_quad(a, b, c, d)
    # tampa superior: leque até o centro no topo (os vértices da última linha
    # válida estão todos com z = z_top por causa do clamp)
    top_ring = []
    jlast = total_rows - rows_per_pitch - 1
    for i in range(n):
        top_ring.append(grid[jlast][i])
    ct = mb.add_vertex((0, 0, z_top))
    for i in range(n):
        j = (i + 1) % n
        mb.add_tri(ct, top_ring[i], top_ring[j])
    return mb.result()


def finalize(v, f):
    m = trimesh.Trimesh(vertices=v, faces=f, process=True)
    m.update_faces(m.nondegenerate_faces(height=1e-4))
    m.remove_unreferenced_vertices()
    return m


def part(name, material, rgb, meshes, alpha=1.0):
    vs, fs, off = [], [], 0
    for v, f in meshes:
        vs.append(v)
        fs.append(f + off)
        off += len(v)
    m = finalize(np.vstack(vs), np.vstack(fs))
    return {"name": name, "material": material, "rgb": rgb, "alpha": alpha, "mesh": m}


# ----------------------------------------------------------------------------
# Cores
# ----------------------------------------------------------------------------
PRETO_FITA = (28, 28, 30)
PAPELAO = (176, 141, 92)
BRANCO_PTFE = (242, 242, 240)
PLASTICO_AZUL = (120, 160, 200)
ACO_ESCURO = (92, 94, 98)
ZINCO_AMARELO = (214, 170, 60)
ZINCO = (170, 172, 176)
NYLON = (200, 196, 180)


# ----------------------------------------------------------------------------
# Itens
# ----------------------------------------------------------------------------
def fita_isolante():
    """Fita isolante 19 mm x 20 m: diâmetro externo 70 mm, núcleo de papelão
    com furo de 38 mm. Inclui a ponta da fita descolada."""
    w = 19.0
    r_in, r_core, r_out = 19.0, 21.5, 35.0
    n = 64
    core = lathe([(r_core, 0), (r_core, w), (r_in, w), (r_in, 0)], n=n)
    fita = lathe([(r_out, 0), (r_out, w), (r_core, w), (r_core, 0)], n=n)
    # ponta descolada: segue a circunferência por 50 graus e sai tangente
    mb = MeshBuilder()
    th0, th1 = math.radians(-60), math.radians(-10)
    pts = []
    k = 14
    for i in range(k + 1):
        th = th0 + (th1 - th0) * i / k
        pts.append((r_out * math.cos(th), r_out * math.sin(th)))
    tx, ty = -math.sin(th1), math.cos(th1)
    for d in (8.0, 16.0, 24.0, 30.0):
        sag = 0.012 * d * d
        px, py = pts[k][0] + tx * d, pts[k][1] + ty * d
        nx, ny = math.cos(th1), math.sin(th1)
        pts.append((px - nx * sag, py - ny * sag))
    t = 0.6
    rings = []
    for (x, y) in pts:
        rr = math.hypot(x, y)
        nx, ny = x / rr, y / rr
        a = mb.add_vertex((x + nx * 0.05, y + ny * 0.05, 0))
        b = mb.add_vertex((x + nx * 0.05, y + ny * 0.05, w))
        c = mb.add_vertex((x + nx * (t + 0.05), y + ny * (t + 0.05), w))
        d = mb.add_vertex((x + nx * (t + 0.05), y + ny * (t + 0.05), 0))
        rings.append((a, b, c, d))
    for i in range(len(rings) - 1):
        a0, b0, c0, d0 = rings[i]
        a1, b1, c1, d1 = rings[i + 1]
        mb.add_quad(a0, a1, b1, b0)   # face interna
        mb.add_quad(b0, b1, c1, c0)   # topo
        mb.add_quad(c0, c1, d1, d0)   # face externa
        mb.add_quad(d0, d1, a1, a0)   # base
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        a, b, c, d = ring
        if flip:
            mb.add_quad(a, b, c, d)
        else:
            mb.add_quad(d, c, b, a)
    ponta = mb.result()
    return {
        "name": "Fita isolante 19mm",
        "parts": [
            part("fita", "Fita isolante - preto", PRETO_FITA, [fita, ponta]),
            part("nucleo", "Papelao", PAPELAO, [core]),
        ],
    }


def fita_veda_rosca():
    """Fita veda-rosca 18 mm x 10 m em carretel plástico."""
    w = 18.0
    r_hole, r_core, r_tape, r_flange = 12.0, 14.5, 23.0, 24.5
    fl = 1.0
    n = 64
    tape = lathe([(r_tape, fl), (r_tape, fl + w), (r_core, fl + w), (r_core, fl)], n=n)
    spool = lathe([(r_hole, 0), (r_flange, 0), (r_flange, fl), (r_core, fl), (r_core, fl + w),
                   (r_flange, fl + w), (r_flange, 2 * fl + w), (r_hole, 2 * fl + w)], n=n)
    return {
        "name": "Fita veda-rosca 18mm",
        "parts": [
            part("fita", "PTFE branco", BRANCO_PTFE, [tape]),
            part("carretel", "Plastico azul", PLASTICO_AZUL, [spool], alpha=0.85),
        ],
    }


def prego():
    """Prego 17x27 (diâmetro 3,0 mm, comprimento 62 mm)."""
    d, L = 3.0, 62.0
    r = d / 2
    tip = 9.0
    rh, th = 3.3, 1.3
    profile = [(0, 0), (r * 0.35, tip * 0.25), (r, tip), (r, L - th),
               (rh, L - th), (rh, L - th * 0.45), (rh * 0.75, L), (0, L)]
    body = lathe(profile, n=32, closed=False)
    return {"name": "Prego 17x27 (3,0 x 62mm)",
            "parts": [part("prego", "Aco escuro", ACO_ESCURO, [body])]}


def parafuso():
    """Parafuso para madeira 4,0 x 40 mm, cabeça chata Phillips, bicromatizado."""
    L = 40.0
    r_core, r_out, pitch = 1.45, 2.0, 1.8
    thread_top = 29.0
    r_shank = 1.6
    rh = 4.0
    head_h = rh - r_shank  # cone de 90 graus
    z_head0 = L - head_h
    thread = helical_thread(r_core, r_out, pitch, 0.0, thread_top, n=32,
                            rows_per_pitch=6, tip_len=6.5)
    # topo da cabeça com fenda Phillips (recesso em cruz)
    w, arm, depth = 0.55, 2.3, 1.5
    thetas = set()
    for q in range(4):
        base = q * math.pi / 2
        for a in (math.atan2(w, arm), math.pi / 4, math.atan2(arm, w)):
            thetas.add(base + a)
    for i in range(48):
        thetas.add(TAU * i / 48)
    thetas = sorted(t % TAU for t in thetas)
    # haste lisa + cone da cabeça (mesmos ângulos do topo para casar os vértices)
    shank = lathe([(0, thread_top), (r_core, thread_top), (r_shank, thread_top + 0.4), (r_shank, z_head0),
                   (rh, L)], closed=False, thetas=thetas)

    def r_cross(th):
        s, c = abs(math.sin(th)), abs(math.cos(th))
        h = min(w / s if s > 1e-9 else 1e9, arm / c if c > 1e-9 else 1e9)
        v = min(w / c if c > 1e-9 else 1e9, arm / s if s > 1e-9 else 1e9)
        return max(h, v)

    rc = [r_cross(t) for t in thetas]
    mb = MeshBuilder()
    n = len(thetas)
    top_out = [mb.add_vertex((rh * math.cos(t), rh * math.sin(t), L)) for t in thetas]
    top_in = [mb.add_vertex((rc[i] * math.cos(t), rc[i] * math.sin(t), L)) for i, t in enumerate(thetas)]
    low_in = [mb.add_vertex((rc[i] * math.cos(t), rc[i] * math.sin(t), L - depth)) for i, t in enumerate(thetas)]
    cf = mb.add_vertex((0, 0, L - depth))
    for i in range(n):
        j = (i + 1) % n
        mb.add_quad(top_out[i], top_out[j], top_in[j], top_in[i])   # anel do topo
        mb.add_quad(top_in[i], top_in[j], low_in[j], low_in[i])     # parede do recesso
        mb.add_tri(cf, low_in[i], low_in[j])                        # fundo
    head_top = mb.result()
    return {"name": "Parafuso 4,0 x 40mm Phillips",
            "parts": [part("parafuso", "Zinco amarelo", ZINCO_AMARELO, [thread, shank, head_top])]}


def bucha():
    """Bucha de nylon 6 mm (comprimento 30 mm), com colarinho e duas fendas."""
    L = 30.0
    r_out, r_in = 3.0, 2.0
    collar_r, collar_h = 3.9, 1.5
    slot_w = 1.4          # largura da fenda (mm)
    slot_len = 18.0       # altura da zona com fendas, a partir da base
    n = 40
    upper = lathe([(r_in, slot_len), (r_out, slot_len), (r_out, L - collar_h), (collar_r, L - collar_h),
                   (collar_r, L), (r_in, L)], n=n)
    # zona com fendas: dois meio-tubos
    half = math.asin(slot_w / 2 / r_out)
    tip_r = 2.4  # leve afunilamento na base
    parts = []
    for base in (0.0, math.pi):
        t0, t1 = base + half, base + math.pi - half
        sec = lathe([(tip_r, 0), (r_out, 3.0), (r_out, slot_len), (r_in, slot_len), (r_in, 3.0), (tip_r - 0.6, 0)],
                    n=n // 2, closed=True, theta0=t0, theta1=t1, caps=True)
        parts.append(sec)
    # aletas antigiro
    fins = []
    for base in (math.pi / 2, 3 * math.pi / 2):
        fw = math.radians(5)
        fin = lathe([(r_out - 0.2, 6.0), (r_out + 0.6, 7.5), (r_out + 0.6, slot_len + 4), (r_out - 0.2, slot_len + 5)],
                    n=2, closed=True, theta0=base - fw, theta1=base + fw, caps=True)
        fins.append(fin)
    return {"name": "Bucha nylon 6mm",
            "parts": [part("bucha", "Nylon", NYLON, [upper] + parts + fins)]}


def porca():
    """Porca sextavada M6: 10 mm entre faces, 5 mm de altura."""
    af, h, r_hole = 10.0, 5.0, 2.6
    a = af / 2
    thetas = sorted({TAU * i / 48 for i in range(48)} | {math.pi / 6 + k * math.pi / 3 for k in range(6)})
    r_out, r_in = [], []
    for t in thetas:
        k = round((t) / (math.pi / 3))
        center = k * math.pi / 3
        r_out.append(a / math.cos(t - center))
        r_in.append(r_hole)
    body = polar_prism(thetas, r_out, r_in, 0.0, h)
    # chanfro superior simplificado: anel cônico
    return {"name": "Porca sextavada M6",
            "parts": [part("porca", "Zinco", ZINCO, [body])]}


def arruela():
    """Arruela lisa M6: 12,5 mm externo, 6,4 mm furo, 1,6 mm de espessura."""
    body = lathe([(6.25, 0), (6.25, 1.6), (3.2, 1.6), (3.2, 0)], n=48)
    return {"name": "Arruela lisa M6",
            "parts": [part("arruela", "Zinco", ZINCO, [body])]}


ITEMS = [fita_isolante, fita_veda_rosca, prego, parafuso, bucha, porca, arruela]


# ----------------------------------------------------------------------------
# Exportadores
# ----------------------------------------------------------------------------
def slug(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    out = "".join(ch if ch.isalnum() else "_" for ch in s.lower())
    while "__" in out:
        out = out.replace("__", "_")
    return out.strip("_")


def fmt(x):
    return ("%.4f" % x).rstrip("0").rstrip(".")


def write_dae(path, items, layout):
    """items: lista de dicts; layout: lista de (x, y, z) por item."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    mats = {}
    for it in items:
        for p in it["parts"]:
            mats[p["material"]] = (p["rgb"], p["alpha"])
    L = []
    L.append('<?xml version="1.0" encoding="utf-8"?>')
    L.append('<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">')
    L.append('<asset><contributor><authoring_tool>gerar_blocos.py</authoring_tool></contributor>'
             f'<created>{now}</created><modified>{now}</modified>'
             '<unit name="millimeter" meter="0.001"/><up_axis>Z_UP</up_axis></asset>')
    L.append('<library_effects>')
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
    geoms = []  # (gid, material id)
    for ii, it in enumerate(items):
        for pi, p in enumerate(it["parts"]):
            m = trimesh.graph.smooth_shade(p["mesh"], angle=math.radians(35))
            gid = f"g{ii}_{pi}"
            mid = "mat_" + slug(p["material"])
            V = m.vertices
            N = m.vertex_normals
            F = m.faces
            pos = " ".join(fmt(x) for x in V.ravel())
            nrm = " ".join("%.4f" % x for x in N.ravel())
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
            geoms.append((ii, gid, mid))
    L.append('</library_geometries><library_visual_scenes><visual_scene id="scene" name="scene">')
    for ii, it in enumerate(items):
        x, y, z = layout[ii]
        L.append(f'<node id="node{ii}" name="{it["name"]}" type="NODE"><translate>{fmt(x)} {fmt(y)} {fmt(z)}</translate>')
        for (jj, gid, mid) in geoms:
            if jj != ii:
                continue
            L.append(f'<instance_geometry url="#{gid}"><bind_material><technique_common>'
                     f'<instance_material symbol="{mid}_sym" target="#{mid}"/>'
                     '</technique_common></bind_material></instance_geometry>')
        L.append('</node>')
    L.append('</visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene></COLLADA>')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))


def write_obj(path, items, layout):
    mtl_path = os.path.splitext(path)[0] + ".mtl"
    mats = {}
    for it in items:
        for p in it["parts"]:
            mats[p["material"]] = (p["rgb"], p["alpha"])
    with open(mtl_path, "w", encoding="utf-8") as fh:
        for name, (rgb, alpha) in mats.items():
            r, g, b = [c / 255 for c in rgb]
            fh.write(f"newmtl {slug(name)}\nKd {r:.4f} {g:.4f} {b:.4f}\nKa 0 0 0\nKs 0.1 0.1 0.1\nNs 20\nd {alpha}\n\n")
    off = 1
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("# Blocos de ferragens - unidades em milimetros, Z para cima\n")
        fh.write(f"mtllib {os.path.basename(mtl_path)}\n")
        for ii, it in enumerate(items):
            x, y, z = layout[ii]
            fh.write(f"o {slug(it['name'])}\n")
            for p in it["parts"]:
                m = p["mesh"]
                fh.write(f"g {slug(it['name'])}_{slug(p['name'])}\nusemtl {slug(p['material'])}\n")
                for v in m.vertices:
                    fh.write(f"v {fmt(v[0] + x)} {fmt(v[1] + y)} {fmt(v[2] + z)}\n")
                for f in m.faces:
                    fh.write(f"f {f[0] + off} {f[1] + off} {f[2] + off}\n")
                off += len(m.vertices)


def write_stl(path, item):
    ms = [p["mesh"] for p in item["parts"]]
    trimesh.util.concatenate(ms).export(path)


def write_ruby(path, items, layout):
    L = []
    L.append("# encoding: UTF-8")
    L.append("# Blocos de ferragens para SketchUp (gerado por gerar_blocos.py)")
    L.append("# Como usar: Janela > Console Ruby e cole:")
    L.append('#   load "C:/caminho/para/blocos_ferragens.rb"')
    L.append("# Cria um componente por item, com materiais, em milímetros reais.")
    L.append("require 'sketchup.rb'")
    L.append("module MK4U_Blocos")
    L.append("  SMOOTH = Geom::PolygonMesh::AUTO_SOFTEN | Geom::PolygonMesh::SMOOTH_SOFT_EDGES")
    L.append("  ITEMS = [")
    for ii, it in enumerate(items):
        x, y, z = layout[ii]
        L.append(f"    {{ name: {it['name']!r}, pos: [{fmt(x)}, {fmt(y)}, {fmt(z)}], parts: [")
        for p in it["parts"]:
            m = p["mesh"]
            r, g, b = p["rgb"]
            pts = ",".join(f"[{fmt(v[0])},{fmt(v[1])},{fmt(v[2])}]" for v in m.vertices)
            tris = ",".join(f"[{f[0]},{f[1]},{f[2]}]" for f in m.faces)
            L.append(f"      {{ material: {p['material']!r}, rgb: [{r},{g},{b}], alpha: {p['alpha']},")
            L.append(f"        pts: [{pts}],")
            L.append(f"        tris: [{tris}] }},")
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
    model.start_operation('Blocos de ferragens', true)
    ITEMS.each do |item|
      defn = model.definitions.add(item[:name])
      item[:parts].each do |part|
        mat = material(model, part[:material], part[:rgb], part[:alpha])
        add_part(defn.entities, mat, part[:pts], part[:tris])
      end
      pos = item[:pos]
      tr = Geom::Transformation.new(Geom::Point3d.new(pos[0].mm, pos[1].mm, pos[2].mm))
      model.active_entities.add_instance(defn, tr)
    end
    model.commit_operation
    model.active_view.zoom_extents
    puts "Blocos criados: #{ITEMS.map { |i| i[:name] }.join(', ')}"
  end
end
MK4U_Blocos.run
""")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))


def render_preview(path, items):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    light = np.array([0.4, -0.6, 0.7])
    light /= np.linalg.norm(light)
    fig = plt.figure(figsize=(16, 8.5), dpi=110)
    for k, it in enumerate(items):
        ax = fig.add_subplot(2, 4, k + 1, projection="3d")
        allv = []
        for p in it["parts"]:
            m = p["mesh"]
            tri = m.vertices[m.faces]
            n = m.face_normals
            shade = 0.35 + 0.65 * np.clip(n @ light, 0, 1)
            base = np.array(p["rgb"]) / 255
            cols = np.clip(base[None, :] * shade[:, None], 0, 1)
            coll = Poly3DCollection(tri, facecolors=cols, edgecolors="none", alpha=p["alpha"])
            ax.add_collection3d(coll)
            allv.append(m.vertices)
        V = np.vstack(allv)
        c = (V.max(0) + V.min(0)) / 2
        rad = (V.max(0) - V.min(0)).max() / 2 * 1.05
        ax.set_xlim(c[0] - rad, c[0] + rad)
        ax.set_ylim(c[1] - rad, c[1] + rad)
        ax.set_zlim(c[2] - rad, c[2] + rad)
        ax.set_box_aspect((1, 1, 1))
        ax.view_init(elev=28, azim=-55)
        ax.set_axis_off()
        size = V.max(0) - V.min(0)
        ax.set_title(f"{it['name']}\n{size[0]:.0f} x {size[1]:.0f} x {size[2]:.0f} mm", fontsize=10)
    ax = fig.add_subplot(2, 4, 8)
    ax.axis("off")
    tri_total = sum(len(p["mesh"].faces) for it in items for p in it["parts"])
    ax.text(0, 0.9, "Blocos de ferragens\npara SketchUp", fontsize=14, weight="bold", va="top")
    ax.text(0, 0.55, f"{len(items)} itens, {tri_total:,} triângulos no total\n"
            "Unidades: milímetros, eixo Z para cima\n"
            "Formatos: DAE, OBJ, STL e script Ruby", fontsize=10, va="top")
    fig.tight_layout()
    fig.savefig(path, facecolor="white")
    plt.close(fig)


def main():
    items = [fn() for fn in ITEMS]
    # layout em linha, com espaço proporcional ao tamanho
    layout, x = [], 0.0
    for it in items:
        V = np.vstack([p["mesh"].vertices for p in it["parts"]])
        w = V[:, 0].max() - V[:, 0].min()
        x += -V[:, 0].min()
        layout.append((x, 0.0, -V[:, 2].min()))
        x += V[:, 0].max() + 25.0

    for d in ("dae", "obj", "stl", "sketchup-ruby"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)

    for it in items:
        s = slug(it["name"])
        origin = [(0.0, 0.0, 0.0)]
        write_dae(os.path.join(OUT, "dae", s + ".dae"), [it], origin)
        write_obj(os.path.join(OUT, "obj", s + ".obj"), [it], origin)
        write_stl(os.path.join(OUT, "stl", s + ".stl"), it)
    write_dae(os.path.join(OUT, "dae", "todos_os_blocos.dae"), items, layout)
    write_obj(os.path.join(OUT, "obj", "todos_os_blocos.obj"), items, layout)
    write_ruby(os.path.join(OUT, "sketchup-ruby", "blocos_ferragens.rb"), items, layout)
    render_preview(os.path.join(OUT, "preview.png"), items)

    for it in items:
        for p in it["parts"]:
            m = p["mesh"]
            print(f"{it['name']:32s} {p['name']:10s} verts={len(m.vertices):6d} tris={len(m.faces):6d} "
                  f"watertight={m.is_watertight} winding_ok={m.is_winding_consistent}")

    zpath = os.path.join(OUT, "blocos_ferragens_sketchup.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for d in ("dae", "obj", "stl", "sketchup-ruby"):
            for f in sorted(os.listdir(os.path.join(OUT, d))):
                zf.write(os.path.join(OUT, d, f), os.path.join(d, f))
        for f in ("preview.png", "README.md"):
            fp = os.path.join(OUT, f)
            if os.path.exists(fp):
                zf.write(fp, f)
    print("zip:", zpath)


if __name__ == "__main__":
    main()
