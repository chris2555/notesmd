"""Genera el icono de notesmd (PNG) sin dependencias externas de diseño."""

from pathlib import Path

from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent
SCALE = 4
SIZE = 512 * SCALE


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def build():
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # chasis
    rounded(draw, (0, 0, SIZE, SIZE), int(SIZE * 0.21), "#0E1622")

    # hoja de papel
    left, top, right, bottom = (SIZE * 0.21, SIZE * 0.175, SIZE * 0.79, SIZE * 0.825)
    rounded(draw, (left, top, right, bottom), int(SIZE * 0.03), "#5AA2F7")

    # esquina doblada
    fold_x = left + (right - left) * 0.74
    fold_y = top + (bottom - top) * 0.185
    draw.polygon(
        [(fold_x - 3, top - 5), (right + 8, top - 5), (right + 8, fold_y + 20)],
        fill="#0E1622",
    )
    draw.polygon(
        [(fold_x, top), (right, fold_y), (fold_x, fold_y)],
        fill="#2F6FD6",
    )

    # renglones
    ink = "#07131F"
    x1 = left + (right - left) * 0.19
    x2 = right - (right - left) * 0.17
    line_h = SIZE * 0.024
    for index, y in enumerate((0.46, 0.555, 0.65)):
        end = x2 if index < 2 else x1 + (x2 - x1) * 0.6
        draw.rounded_rectangle(
            (x1, SIZE * y, end, SIZE * y + line_h),
            radius=line_h / 2,
            fill=ink,
        )

    for size in (512, 256, 128, 64):
        out = image.resize((size, size), Image.Resampling.LANCZOS)
        out.save(BASE / f"icon-{size}.png")

    image.resize((512, 512), Image.Resampling.LANCZOS).save(BASE / "icon.png")
    print("iconos generados en", BASE)


if __name__ == "__main__":
    build()
