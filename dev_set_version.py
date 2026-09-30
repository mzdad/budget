"""Sets the page's version number: python dev_set_version.py 1.3.0

The version lives in one place, the ?v=... at the end of each of our own files in index.html
(style.css and the scripts). app.js reads it from its own address and shows it at the bottom of
the page, and a new number makes phones fetch new files instead of using old ones from their
cache. This script changes every ?v=... in index.html at once, so none can be forgotten.
Not part of the app.
"""

import re
import sys

if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
	sys.exit("Use it like this:  python dev_set_version.py 1.3.0")

new_version = sys.argv[1]

with open("index.html", encoding="utf-8") as file:
	text = file.read()

text, count = re.subn(r"\?v=\d+\.\d+\.\d+", "?v=" + new_version, text)
if count == 0:
	sys.exit("No ?v=... found in index.html")

with open("index.html", "w", encoding="utf-8") as file:
	file.write(text)

print("index.html now says version %s (%d places changed)" % (new_version, count))
print("Next: add a line to CHANGELOG.md, run node test.js, commit and push.")
