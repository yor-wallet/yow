"""HONOR spec page → {'colors': [...], 'groups': {group: {label: value}}}. python3 -I honor_extract.py <html>"""
import re, sys, json, html as H

def extract(path):
    raw = open(path, encoding='utf-8', errors='replace').read()
    colors = re.findall(r'color-name-list" value="([^"]*)"', raw)
    out, group = {}, None
    # walk H2 group titles and (H3 label, data-value) pairs in document order
    for m in re.finditer(r'<h2 id="spectitle-\d+"[^>]*>(.*?)</h2>|<h3 class="[^"]*item-list-item-p1[^"]*">(.*?)</h3>\s*<div class="products-spec-component-list-item-desc-container">\s*<div class="cc-product-content-container" data-class="p2" data-value="([^"]*)"', raw, flags=re.S):
        if m.group(1) is not None:
            group = H.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip(); out.setdefault(group, {})
        elif group:
            label = H.unescape(re.sub(r'<[^>]+>', '', m.group(2))).strip()
            out[group][label] = H.unescape(m.group(3)).strip()
    # variant (memory+storage) lines have no h3 label in some pages: pick Memory group from data-value pairs
    mem = re.findall(r'data-value="(\d+\s?GB\s?\+\s?\d+\s?(?:GB|TB)[^"]*)"', raw)
    return {'colors': list(dict.fromkeys(colors)), 'groups': out, 'memoryLines': list(dict.fromkeys(mem))}

if __name__ == '__main__':
    print(json.dumps(extract(sys.argv[1]), ensure_ascii=False, indent=1))
