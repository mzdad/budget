"""Draws the app icon (a green square with three rising bars) as PNG files.

Run it once with:   python dev_make_icons.py
It writes icon-180.png (iPhone home screen), icon-192.png and icon-512.png
(Android / manifest). Only Python's own libraries are used, so nothing has to
be installed. Not part of the app - the PNGs it makes are.
"""

import struct
import zlib

GREEN = (31, 122, 90)
WHITE = (255, 255, 255)

# Each bar is (left, height), as fractions of the icon size. The bars share one
# baseline and are all the same width.
BAR_WIDTH = 0.16
BASELINE = 0.74
BARS = [(0.22, 0.22), (0.42, 0.36), (0.62, 0.50)]


def colour_at(x, y, size):
	"""Which colour is the pixel at (x, y)?"""
	fx = x / size
	fy = y / size
	for left, height in BARS:
		if left <= fx < left + BAR_WIDTH and BASELINE - height <= fy < BASELINE:
			return WHITE
	# A thin line under the bars, a little wider than the bars themselves.
	if 0.16 <= fx < 0.84 and BASELINE + 0.02 <= fy < BASELINE + 0.045:
		return WHITE
	return GREEN


def write_png(path, size):
	rows = bytearray()
	for y in range(size):
		rows.append(0)   # PNG wants a "filter type" byte (0 = none) before every row
		for x in range(size):
			rows.extend(colour_at(x, y, size))

	def chunk(kind, body):
		checked = kind + body
		return struct.pack(">I", len(body)) + checked + struct.pack(">I", zlib.crc32(checked) & 0xFFFFFFFF)

	header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)   # 8 bits, RGB colour
	png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")
	with open(path, "wb") as file:
		file.write(png)
	print("wrote", path)


for icon_size in (180, 192, 512):
	write_png("icon-%d.png" % icon_size, icon_size)
