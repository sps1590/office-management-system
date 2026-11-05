import io, re, sys

for path in sys.argv[1:]:
    text = io.open(path, encoding="utf-8").read()
    if re.search(r"\bconst tz = ", text):
        continue
    m = re.search(r"^(\s*)const currency = user\.tenant\.currency;[^\n]*\n", text, re.M)
    if m:
        text = text[: m.end()] + f"{m.group(1)}const tz = user.tenant.timezone;\n" + text[m.end():]
    else:
        m = re.search(r"^(\s*)const user = await require[A-Za-z]*\((?:[^()]|\([^()]*\))*\);[^\n]*\n", text, re.M)
        if not m:
            print("NO ANCHOR:", path)
            continue
        text = text[: m.end()] + f"{m.group(1)}const tz = user.tenant.timezone;\n" + text[m.end():]
    io.open(path, "w", encoding="utf-8", newline="").write(text)
print("done")
