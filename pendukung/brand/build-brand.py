"""
Generator aset brand Sirko (sumber tunggal logo).

Menghasilkan SVG master + PNG untuk: web (favicon, PWA, OG), Play Store (ikon 512, feature
graphic 1024x500) dan Android launcher (mipmap legacy + adaptive foreground/monochrome).

    python pendukung/brand/build-brand.py [--flutter C:/project/sirko/sirko-flutter]

Butuh: playwright (Chromium/Chrome) + Pillow.
"""
import argparse
import pathlib

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out"
SITE = ROOT.parents[1] / "public" / "site"

GREEN, GREEN_D, MANGO, NAVY, PAPER, LINE, CREAM = "#0F7B5F", "#0A5A45", "#FF9F1C", "#14213D", "#FFFFFF", "#C9D3DD", "#FFE7C2"


def art(color=True):
    """Tenda warung + struk bercentang pada kanvas 512 (tanpa latar). color=False → satu warna (putih)."""
    o = MANGO if color else "#fff"
    w = CREAM if color else "none"
    chk = MANGO if color else "#000"
    ln = LINE if color else "#000"
    # struk: badan + gerigi bawah (6 gigi)
    teeth = []
    x0, x1, yb, depth = 140, 372, 412, 22
    step = (x1 - x0) / 6
    for i in range(6):
        teeth.append(f"L{x1 - step * i - step / 2:.1f} {yb - depth} L{x1 - step * (i + 1):.1f} {yb}")
    receipt_fill = PAPER if color else "#fff"
    receipt = f'<path d="M{x0} 178 H{x1} V{yb} {" ".join(teeth)} Z" fill="{receipt_fill}"/>'
    check = f'<path d="M176 290 L212 326 L268 260" fill="none" stroke="{chk}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>'
    lines = f'<path d="M298 268 H340 M298 300 H340 M298 332 H326" stroke="{ln}" stroke-width="16" stroke-linecap="round"/>'
    # tenda: atap belang (5 lajur 64px) + jumbai setengah lingkaran
    stripes = []
    for i in range(5):
        fill = o if i % 2 == 0 else w
        if fill == "none":
            continue
        x = 96 + 64 * i
        r = 26 if i in (0, 4) else 0
        top = (f"M{x + r} 100 H{x + 64}" if i == 0 else f"M{x} 100 H{x + 64 - r} Q{x + 64} 100 {x + 64} {100 + r}" if i == 4 else f"M{x} 100 H{x + 64}")
        left = f"V{100 + r} Q{x} 100 {x + r} 100" if i == 0 else f"V100"
        stripes.append(f'<path d="{top} V156 A32 32 0 0 1 {x} 156 {left} Z" fill="{fill}"/>')
    if not color:
        # satu warna: atap utuh agar siluet tetap terbaca
        # satu warna: tiap lajur tenda utuh, dipisah celah tipis agar belang tetap terbaca
        roof = []
        for i in range(5):
            x, r = 96 + 64 * i, (26 if i in (0, 4) else 0)
            top = (f"M{x + r} 100 H{x + 64}" if i == 0 else f"M{x} 100 H{x + 64 - r} Q{x + 64} 100 {x + 64} {100 + r}" if i == 4 else f"M{x} 100 H{x + 64}")
            left = f"V{100 + r} Q{x} 100 {x + r} 100" if i == 0 else "V100"
            roof.append(f'<path d="{top} V156 A32 32 0 0 1 {x} 156 {left} Z" fill="#fff"/>')
        gaps = "".join(f'<rect x="{x - 5}" y="96" width="10" height="100" fill="#000"/>' for x in (160, 224, 288, 352))
        stripes = [f'<mask id="g"><rect width="512" height="512" fill="#fff"/>{gaps}</mask><g mask="url(#g)">' + "".join(roof) + '</g>']
        check = f'<path d="M176 290 L212 326 L268 260" fill="none" stroke="#000" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>'
        lines = '<path d="M298 268 H340 M298 300 H340 M298 332 H326" stroke="#000" stroke-width="16" stroke-linecap="round"/>'
        body = f'<mask id="m"><rect width="512" height="512" fill="#000"/>{receipt}{check}{lines}</mask>'
        return f'<defs>{body}</defs><rect width="512" height="512" fill="#fff" mask="url(#m)"/>' + "".join(stripes)
    return receipt + check + lines + "".join(stripes)


def svg(inner, size=512, bg=None, radius=112, scale=1.0, view=512):
    pad = view * (1 - scale) / 2
    bgel = f'<rect width="{view}" height="{view}" rx="{radius}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view} {view}" width="{size}" height="{size}">'
            f'{bgel}<g transform="translate({pad:.2f} {pad:.2f}) scale({scale})">{inner}</g></svg>')


WORDMARK_FONT = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;800&display=swap"


def lockup_html(dark=False):
    color = "#EEF1F7" if dark else NAVY
    mark = svg(art(), size=200, bg=GREEN)
    return (f'<html><head><link href="{WORDMARK_FONT}" rel="stylesheet"></head>'
            f'<body style="margin:0;background:transparent;display:inline-flex;align-items:center;gap:44px;padding:24px;font-family:\'Plus Jakarta Sans\'">'
            f'{mark}<span style="font-size:190px;font-weight:800;letter-spacing:-.045em;color:{color};line-height:1">sirko</span></body></html>')


def feature_graphic_html():
    mark = svg(art(), size=250, bg=GREEN)
    return f"""<html><head><link href="{WORDMARK_FONT}" rel="stylesheet"><style>
body{{margin:0;width:1024px;height:500px;background:#FFFBF4;font-family:'Plus Jakarta Sans';display:flex;align-items:center;gap:52px;padding:0 80px;box-sizing:border-box;overflow:hidden;position:relative}}
h1{{margin:0;font-size:88px;font-weight:800;color:{NAVY};letter-spacing:-.045em;line-height:1}}
p{{margin:14px 0 0;font-size:40px;font-weight:800;color:{GREEN};line-height:1.15;letter-spacing:-.02em}}
small{{display:block;margin-top:18px;font-size:23px;font-weight:600;color:#5B6478}}
.bar{{position:absolute;left:0;right:0;bottom:0;height:16px;background:linear-gradient(90deg,{GREEN} 0 70%,{MANGO} 70%)}}
</style></head><body>{mark}<div><h1>sirko</h1><p>Kasir toko,<br>untung kelihatan.</p><small>Kasir · stok · kasbon · pulsa &amp; token listrik</small></div><div class="bar"></div></body></html>"""


def og_html():
    return feature_graphic_html().replace("width:1024px;height:500px", "width:1200px;height:630px").replace("padding:0 80px", "padding:0 96px").replace("font-size:88px", "font-size:104px")


def render(page, html, w, h, path, transparent=False):
    page.set_viewport_size({"width": w, "height": h})
    page.set_content(html, wait_until="networkidle")
    page.screenshot(path=str(path), omit_background=transparent, clip={"x": 0, "y": 0, "width": w, "height": h})


def render_svg(page, svg_text, n, path, transparent=True):
    render(page, f"<html><body style='margin:0;width:{n}px;height:{n}px'>{svg_text}</body></html>".replace(
        'width="512" height="512"', f'width="{n}" height="{n}"', 1), n, n, path, transparent)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--flutter", help="Path proyek Flutter: tulis ikon launcher Android ke android/app/src/main/res")
    a = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    (SITE / "img").mkdir(parents=True, exist_ok=True)

    color = art()
    mark = svg(color, bg=GREEN)  # ikon utama (kotak membulat)
    square = svg(color, bg=GREEN, radius=0)  # Play Store: kotak penuh, Google menerapkan sudut sendiri
    fg = svg(color, scale=0.62)  # adaptive foreground (zona aman 66/108)
    mono = svg(art(color=False), scale=0.62)  # Android 13 themed icon
    files = {
        "sirko-mark.svg": mark,
        "sirko-mark-square.svg": square,
        "sirko-adaptive-foreground.svg": fg,
        "sirko-monochrome.svg": mono,
    }
    for name, text in files.items():
        (OUT / name).write_text(text, encoding="utf8")
    (SITE / "img" / "logo-mark.svg").write_text(mark, encoding="utf8")

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome")
        pg = b.new_page()
        # Play Store
        render_svg(pg, square, 512, OUT / "playstore-icon-512.png", transparent=False)
        render(pg, feature_graphic_html(), 1024, 500, OUT / "playstore-feature-graphic-1024x500.png")
        # Web
        render(pg, og_html(), 1200, 630, SITE / "img" / "og-image.png")
        for n, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png"), (32, "favicon-32.png")]:
            render_svg(pg, mark if name != "apple-touch-icon.png" else square, n, SITE / "img" / name, transparent=name != "apple-touch-icon.png")
        # maskable PWA icon (konten dalam zona aman 80%)
        render_svg(pg, svg(color, bg=GREEN, radius=0, scale=0.8), 512, SITE / "img" / "icon-maskable-512.png", transparent=False)
        # Lockup (logo + tulisan)
        for dark in (False, True):
            pg.set_viewport_size({"width": 1400, "height": 400})
            pg.set_content(lockup_html(dark), wait_until="networkidle")
            box = pg.locator("body").bounding_box()
            pg.screenshot(path=str(OUT / f"sirko-lockup-{'dark' if dark else 'light'}.png"), omit_background=True,
                          clip={"x": 0, "y": 0, "width": box["width"], "height": box["height"]})
        # Android launcher
        mip = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
        for d, n in mip.items():
            render_svg(pg, mark, n, OUT / f"ic_launcher-{d}.png")
            render_svg(pg, svg(color, bg=GREEN, radius=256), n, OUT / f"ic_launcher_round-{d}.png")
            fgn = int(n * 108 / 48)
            render_svg(pg, fg, fgn, OUT / f"ic_launcher_foreground-{d}.png")
            render_svg(pg, mono, fgn, OUT / f"ic_launcher_monochrome-{d}.png")
        # Splash Android 12+ (ikon 288dp x 4 = 1152px; framing = adaptive foreground)
        render_svg(pg, fg, 1152, OUT / "splash_icon.png")
        b.close()

    # favicon.ico (16/32/48)
    Image.open(SITE / "img" / "icon-512.png").save(SITE / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    if a.flutter:
        res = pathlib.Path(a.flutter) / "android" / "app" / "src" / "main" / "res"
        for d in mip:
            dst = res / f"mipmap-{d}"
            dst.mkdir(exist_ok=True)
            for base in ("ic_launcher", "ic_launcher_round", "ic_launcher_foreground", "ic_launcher_monochrome"):
                (dst / f"{base}.png").write_bytes((OUT / f"{base}-{d}.png").read_bytes())
        any26 = res / "mipmap-anydpi-v26"
        any26.mkdir(exist_ok=True)
        xml = ('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
               '    <background android:drawable="@color/ic_launcher_background"/>\n'
               '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
               '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n')
        (any26 / "ic_launcher.xml").write_text(xml, encoding="utf8")
        (any26 / "ic_launcher_round.xml").write_text(xml, encoding="utf8")
        (res / "values" / "ic_launcher_background.xml").write_text(
            f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{GREEN}</color>\n</resources>\n', encoding="utf8")
        nodpi = res / "drawable-nodpi"
        nodpi.mkdir(exist_ok=True)
        (nodpi / "splash_icon.png").write_bytes((OUT / "splash_icon.png").read_bytes())
        print("Ikon launcher ditulis ke", res)
    print("Selesai ->", OUT, "dan", SITE / "img")


if __name__ == "__main__":
    main()
