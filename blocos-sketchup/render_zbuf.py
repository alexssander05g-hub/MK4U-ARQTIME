"""Renderizador ortográfico simples com z-buffer (numpy) para conferir os bins."""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def render(parts, width=520, height=420, azim=-60, elev=35, light=(0.3, -0.7, 0.65), bg=(255, 255, 255), pad=1.08):
    """parts: lista de (rgb, alpha, vertices Nx3, faces Mx3)."""
    az, el = math.radians(azim), math.radians(elev)
    view = np.array([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)])  # direção câmera->cena invertida
    up = np.array([0, 0, 1.0])
    right = np.cross(up, view); right /= np.linalg.norm(right)
    cup = np.cross(view, right)
    allv = np.vstack([v for (_, _, v, _) in parts])
    c = (allv.max(0) + allv.min(0)) / 2
    proj = (allv - c) @ np.stack([right, cup]).T
    span = max(np.ptp(proj[:, 0]) / width, np.ptp(proj[:, 1]) / height) * pad
    L = np.asarray(light, float); L /= np.linalg.norm(L)
    zbuf = np.full((height, width), -np.inf)
    img = np.zeros((height, width, 3), float) + np.array(bg) / 255
    # ordem: opacos primeiro, depois transparentes (mistura simples)
    order = sorted(range(len(parts)), key=lambda i: parts[i][1] < 1)
    for i in order:
        rgb, alpha, V, F = parts[i]
        base = np.array(rgb) / 255
        P = (V - c)
        sx = P @ right / span + width / 2
        sy = height / 2 - P @ cup / span
        sz = P @ view
        tri = F
        n = np.cross(V[tri[:, 1]] - V[tri[:, 0]], V[tri[:, 2]] - V[tri[:, 0]])
        nl = np.linalg.norm(n, axis=1); ok = nl > 1e-12
        n[ok] /= nl[ok][:, None]
        shade = 0.28 + 0.72 * np.clip(n @ L, 0, 1) + 0.15 * np.clip(n @ view, 0, 1)
        for k in np.nonzero(ok)[0]:
            a, b, d = tri[k]
            xs = np.array([sx[a], sx[b], sx[d]]); ys = np.array([sy[a], sy[b], sy[d]]); zs = np.array([sz[a], sz[b], sz[d]])
            x0, x1 = int(max(np.floor(xs.min()), 0)), int(min(np.ceil(xs.max()), width - 1))
            y0, y1 = int(max(np.floor(ys.min()), 0)), int(min(np.ceil(ys.max()), height - 1))
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            det = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
            if abs(det) < 1e-9:
                continue
            w1 = ((gx - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (gy - ys[0])) / det
            w2 = ((xs[1] - xs[0]) * (gy - ys[0]) - (gx - xs[0]) * (ys[1] - ys[0])) / det
            w0 = 1 - w1 - w2
            inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
            if not inside.any():
                continue
            z = w0 * zs[0] + w1 * zs[1] + w2 * zs[2]
            sub = zbuf[y0:y1 + 1, x0:x1 + 1]
            upd = inside & (z > sub)
            if not upd.any():
                continue
            col = np.clip(base * shade[k], 0, 1)
            if alpha >= 1:
                sub[upd] = z[upd]
                img[y0:y1 + 1, x0:x1 + 1][upd] = col
            else:
                img[y0:y1 + 1, x0:x1 + 1][upd] = img[y0:y1 + 1, x0:x1 + 1][upd] * (1 - alpha) + col * alpha
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))


def sheet(images, titles, cols, path, subtitle=None):
    w, h = images[0].size
    rows = math.ceil(len(images) / cols)
    th = 34
    out = Image.new("RGB", (cols * w, rows * (h + th) + (40 if subtitle else 0)), "white")
    dr = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
    except Exception:
        font = ImageFont.load_default()
    for i, (im, t) in enumerate(zip(images, titles)):
        r, cc = divmod(i, cols)
        x, y = cc * w, r * (h + th)
        dr.text((x + 10, y + 8), t, fill=(30, 30, 30), font=font)
        out.paste(im, (x, y + th))
    if subtitle:
        dr.text((10, rows * (h + th) + 10), subtitle, fill=(60, 60, 60), font=font)
    out.save(path)
