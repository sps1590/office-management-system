import io, re, sys, glob, os

def find_calls(text, name):
    """Yield (open_paren_index, close_paren_index) for each `name(` call."""
    out = []
    for m in re.finditer(r"(?<![A-Za-z0-9_$.])" + name + r"\(", text):
        i = m.end() - 1
        depth = 0
        j = i
        while j < len(text):
            c = text[j]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
                if depth == 0:
                    out.append((i, j))
                    break
            elif c in "\"'`":
                q = c
                j += 1
                while j < len(text) and text[j] != q:
                    if text[j] == "\\":
                        j += 1
                    j += 1
            j += 1
    return out

def append_arg(text, name, arg):
    calls = find_calls(text, name)
    for i, j in reversed(calls):
        inner = text[i + 1 : j]
        if inner.strip().endswith(arg) and ("," in inner):
            continue
        text = text[:j] + (f", {arg}" if inner.strip() else arg) + text[j:]
    return text, len(calls)

def prepend_arg(text, name, arg):
    calls = find_calls(text, name)
    for i, j in reversed(calls):
        inner = text[i + 1 : j]
        repl = arg if not inner.strip() else f"{arg}, {inner}"
        text = text[: i + 1] + repl + text[j:]
    return text, len(calls)

token = sys.argv[1]
files = sys.argv[2:]
total = 0
for path in files:
    text = io.open(path, encoding="utf-8").read()
    before = text
    for name in ("formatDateTime", "formatTime", "formatDate"):
        text, n = append_arg(text, name, token)
        total += n
    text, n = prepend_arg(text, "isoDate", token)
    total += n
    if text != before:
        io.open(path, "w", encoding="utf-8", newline="").write(text)
        print("updated", path)
print("calls touched:", total)
