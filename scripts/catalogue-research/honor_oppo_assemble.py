"""HONOR + OPPO official pages → verified entries (colours, configs, specs; NO variants: colour×config matrix unconfirmed).
python3 -I honor_oppo_assemble.py <raw_dir> <out_dir>"""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import spec, storages_value
from honor_extract import extract

raw_dir, out_dir = sys.argv[1], sys.argv[2]
CHECKED = '2026-11-12'

def first_num(s): return re.search(r'[\d.]+', s or '').group(0)
def x(s): return re.sub(r'\s*[×x]\s*', ' × ', (s or '').strip())

def configs_from(lines):
    out = []
    for l in lines:
        for ram, st, unit in re.findall(r'(\d+)\s?GB\s?\+\s?(\d+)\s?(GB|TB)', l):
            out.append((int(ram), int(st) * (1024 if unit == 'TB' else 1)))
    return sorted(set(out), key=lambda c: (c[1], c[0]))

def cfg_specs(cfgs):
    rams = sorted({c[0] for c in cfgs}); sts = sorted({c[1] for c in cfgs})
    return [spec('memory', ' · '.join(f'{r} GB' for r in rams)), spec('storage', storages_value(sts))] if cfgs else []

# ---------------- HONOR ----------------
H = {
 'honor-magic5-pro': ('Magic5 Pro', 2023, 'honor-ae-honor-magic5-pro', 'https://www.honor.com/ae-en/phones/honor-magic5-pro/spec/', 'AE', 'ماجيك 5 برو'),
 'honor-magic6-pro': ('Magic6 Pro', 2024, 'honor-ae-honor-magic6-pro', 'https://www.honor.com/ae-en/phones/honor-magic6-pro/spec/', 'AE', 'ماجيك 6 برو'),
 'honor-magic7-pro': ('Magic7 Pro', 2025, 'honor-om-honor-magic7-pro', 'https://www.honor.com/om/phones/honor-magic7-pro/spec/', 'OM', 'ماجيك 7 برو'),
 'honor-magic8-pro': ('Magic8 Pro', 2025, 'honor-om-honor-magic8-pro', 'https://www.honor.com/om/phones/honor-magic8-pro/spec/', 'OM', 'ماجيك 8 برو'),
 'honor-magic-v3':   ('Magic V3', 2024, 'honor-om-honor-magic-v3', 'https://www.honor.com/om/phones/honor-magic-v3/spec/', 'OM', 'ماجيك V3'),
 'honor-magic-v5':   ('Magic V5', 2025, 'honor-om-honor-magic-v5', 'https://www.honor.com/om/phones/honor-magic-v5/spec/', 'OM', 'ماجيك V5'),
 'honor-magic-v6':   ('Magic V6', 2026, 'honor-om-honor-magic-v6', 'https://www.honor.com/om/phones/honor-magic-v6/spec/', 'OM', 'ماجيك V6'),
}
def mah(s):
    m = re.search(r'(\d{4})\s?mAh\s*\(typical', s or '')
    return m.group(1) if m else (re.search(r'(\d{4})\s?mAh', s or '') or [None, None])[1]

models = []
for mid, (model, year, f, url, site, ar) in H.items():
    d = extract(os.path.join(raw_dir, f + '-spec.html')); g = d['groups']
    folding = 'Inner screen' in g.get('Display', {}).get('Size', '')
    disp, cam, bat, dims = g['Display'], g['Rear Camera'], g['Battery'], g['Dimensions and Weight']
    specs = []
    if folding:
        sizes = re.findall(r'(?:Inner|Outer|External) screen:\s*([\d.]+)', disp['Size'])
        res = re.findall(r'(?:Inner|Outer|External) screen:\s*(\d+\s?[×x]\s?\d+)', disp['Resolution'])
        specs.append(spec('display', f"{sizes[0]}″ · {x(res[0])} px"))
        specs.append(spec('coverDisplay', f"{sizes[1]}″ · {x(res[1])} px"))
    else:
        resv = re.search(r'(\d+\s?[×x]\s?\d+)', disp.get('Resolution', ''))
        specs.append(spec('display', f"{first_num(disp['Size'])}″ {disp.get('Type', '')} · {x(resv.group(1))} px".replace('  ', ' ')))
    cpu = g['Processor']['CPU Model'].replace('®️', '®').replace('®', '').replace('Mobile Platform', '').strip()
    specs.append(spec('chip', cpu))
    cfgs = configs_from(d['memoryLines'])
    specs += cfg_specs(cfgs)
    lenses = []
    for l in [l for l in cam['Rear Camera'].split('\n') if l.strip()] if '\n' in cam['Rear Camera'] else re.split(r'\+(?=\d+MP)', cam['Rear Camera']):
        m = re.match(r'\s*(\d+)MP', l)
        ap = re.search(r'f/([\d.\-f/]+)', l)
        if m: lenses.append(f"{m.group(1)} MP" + (f" (ƒ/{ap.group(1).split('-')[0]})" if ap else ''))
    if lenses: specs.append(spec('rearCamera', ' · '.join(lenses)))
    fm = re.match(r'\s*(\d+)MP', g['Front Camera']['Front Camera'])
    if fm: specs.append(spec('frontCamera', f"{fm.group(1)} MP" + ((' (ƒ/' + re.search(r'f/([\d.]+)', g['Front Camera']['Front Camera']).group(1) + ')') if re.search(r'f/([\d.]+)', g['Front Camera']['Front Camera']) else '')))
    specs.append(spec('battery', {'en': f"{mah(bat['Capacity'])} mAh (typical)", 'fr': f"{mah(bat['Capacity'])} mAh (typique)", 'ar': f"{mah(bat['Capacity'])} مللي أمبير/ساعة (نموذجي)"}))
    w = re.search(r'(\d+)W', bat.get('Wired Charging', ''))
    ww = re.search(r'(\d+)W Wireless', bat.get('Wireless Charging', '') or '')
    if w:
        en = f'Wired {w.group(1)} W' + (f' · wireless {ww.group(1)} W' if ww else '')
        fr = f'Filaire {w.group(1)} W' + (f' · sans fil {ww.group(1)} W' if ww else '')
        ar = f'سلكي {w.group(1)} واط' + (f' · لاسلكي {ww.group(1)} واط' if ww else '')
        specs.append(spec('charging', {'en': en, 'fr': fr, 'ar': ar}))
    raw = open(os.path.join(raw_dir, f + '-spec.html'), encoding='utf-8', errors='replace').read()
    ip = re.search(r'data-value="[^"]*?(IP6\d[^"]*)"', raw)
    if ip:
        codes = re.findall(r'IP\d+K?', ip.group(1))
        specs.append(spec('resistance', ', '.join(dict.fromkeys(codes))))
    specs.append(spec('connectivity', ' · '.join(filter(None, [
        'Wi‑Fi 7' if re.search(r'/be\b', g['Cellular Network'].get('Wi-Fi', '')) else 'Wi‑Fi 6' if re.search(r'/ax\b', g['Cellular Network'].get('Wi-Fi', '')) else None,
        (re.search(r'BT\s?([\d.]+)', g['Cellular Network'].get('Bluetooth', '')) and 'Bluetooth ' + re.search(r'BT\s?([\d.]+)', g['Cellular Network'].get('Bluetooth', '')).group(1)),
        'NFC' if g.get('Sensors', {}).get('NFC', '').startswith('Supp') else None, '5G' if '5G' in g['Cellular Network'].get('Network Standard', '') else None]))))
    if folding:
        h = dims['Height'].replace(' mm', '').strip()
        wf, wu = re.findall(r'([\d.]+) mm', dims['Width'])[:2]
        specs.append(spec('dimensions', {'en': f'Folded: {h} × {wf} mm · unfolded: {h} × {wu} mm (height × width)', 'fr': f'Plié : {h} × {wf} mm · déplié : {h} × {wu} mm (hauteur × largeur)', 'ar': f'مطوي: {h} × {wf} mm · مفتوح: {h} × {wu} mm (الارتفاع × العرض)'}))
    else:
        specs.append(spec('dimensions', f"{first_num(dims['Height'])} × {first_num(dims['Width'])} × {first_num(dims['Depth'])} mm"))
    wt = re.findall(r'Approx\.\s*(\d+)\s*g', dims['Weight'])
    if wt: specs.append(spec('weight', ' – '.join(sorted({*wt}, key=int)) + ' g' if len(set(wt)) > 1 else wt[0] + ' g'))
    specs.append(spec('os', re.sub(r'\s*\((Based|Base) on ([^)]*)\)', r' (\2)', g['System']['Operating System']).replace('(Android', '(Android')))
    specs = [s for s in specs if s]
    models.append({
        'id': mid, 'verified': True, 'brand': 'HONOR', 'series': 'Magic', 'model': f'Magic{model[5:]}' if model.startswith('Magic ') else model, 'year': year,
        'name': {'ar': ar, 'en': 'HONOR ' + model, 'fr': 'HONOR ' + model}, 'region': 'GCC', 'regionModel': None, 'onOfficialRegionalStore': True,
        'sources': [{'label': f"HONOR {'Oman' if site == 'OM' else 'UAE'} — specifications", 'url': url}], 'checkedAt': CHECKED,
        'colors': [{'name': c.strip().title() if c.islower() or c.isupper() else c.strip().replace('Lunar shadow', 'Lunar Shadow'), 'hex': None, 'hexSource': None} for c in d['colors']],
        'configs': [{'ramGb': r, 'storageGb': s} for r, s in cfgs],
        'variantMatrix': 'unconfirmed', 'variants': [], 'specs': specs,
    })

# ---------------- OPPO ----------------
def oppo_lines(f): return [l.strip() for l in open(os.path.join(raw_dir, f), encoding='utf-8').read().split('\n') if l.strip()]
def after(lines, key, n=1):
    i = lines.index(key); return lines[i + 1: i + 1 + n]
O = {
 'oppo-find-x9-pro': ('Find X9 Pro', 2025, 'oppo-ae-find-x9-pro-specs.txt', 'https://www.oppo.com/ae/smartphones/series-find-x/find-x9-pro/specs/', 'UAE', 'GCC', 'أوبو فايند X9 برو'),
 'oppo-find-x8-pro': ('Find X8 Pro', 2024, 'oppo-en-find-x8-pro-specs.txt', 'https://www.oppo.com/en/smartphones/series-find-x/find-x8-pro/specs/', 'Global', 'GLOBAL', 'أوبو فايند X8 برو'),
 'oppo-find-x8':     ('Find X8', 2024, 'oppo-en-find-x8-specs.txt', 'https://www.oppo.com/en/smartphones/series-find-x/find-x8/specs/', 'Global', 'GLOBAL', 'أوبو فايند X8'),
}
for mid, (model, year, f, url, site, region, ar) in O.items():
    L = oppo_lines(f)
    title_i = next(i for i, l in enumerate(L) if l.startswith('OPPO ' + model) and '(CPH' in l)
    cph = re.search(r'\((CPH\d+)\)', L[title_i]).group(1)
    colors = [c.strip() for c in L[title_i + 1].split('|')]
    cfgs = configs_from(L[L.index('RAM and ROM Capacities') + 1: L.index('RAM and ROM Capacities') + 5])
    def val(k): return L[L.index(k) + 1]
    h, w, t, wt = [re.search(r'([\d.]+)\s?mm|([\d.]+)\s?g', val(k)) for k in ('Height', 'Width', 'Thickness', 'Weight')]
    num = lambda m: m.group(1) or m.group(2)
    disp_i = L.index('Display'); dsz = re.search(r'([\d.]+)\s?inches', L[disp_i + 2]).group(1); dres = re.search(r'(\d+\s?×\s?\d+)', L[L.index('Resolution', disp_i) + 1]).group(1)
    hz = re.search(r'Maximum:\s*(\d+)Hz', L[L.index('Refresh Rate', disp_i) + 1]).group(1)
    cam_i = L.index('Camera'); rear = []
    for l in L[cam_i + 2: cam_i + 8]:
        m = re.match(r'(Ultra-wide angle|Wide angle|Telephoto|Monochrome): (\d+)MP; f/([\d.]+)', l)
        if m and m.group(1) != 'Monochrome': rear.append(f"{m.group(2)} MP ({'ƒ/' + m.group(3)})")
    front = re.search(r'^(\d+)MP; f/([\d.]+)', L[L.index('Front', cam_i) + 1])
    soc = val('SoC')
    bat_i = L.index('Battery'); typ = re.search(r'(\d{4})mAh', L[bat_i + 2]).group(1)
    fc = re.search(r'Supports \(MAX\): (\d+)W', ' '.join(L[bat_i + 3: bat_i + 6]))
    specs = [spec('display', f"{dsz}″ AMOLED · {dres.replace(' ', '')} px · {hz} Hz".replace('×', ' × ')), spec('chip', soc)] + cfg_specs(cfgs)
    specs += [spec('rearCamera', ' · '.join(rear)), spec('frontCamera', f"{front.group(1)} MP (ƒ/{front.group(2)})" if front else None),
              spec('battery', {'en': f'{typ} mAh (typical)', 'fr': f'{typ} mAh (typique)', 'ar': f'{typ} مللي أمبير/ساعة (نموذجي)'}),
              spec('charging', {'en': f'Wired {fc.group(1)} W', 'fr': f'Filaire {fc.group(1)} W', 'ar': f'سلكي {fc.group(1)} واط'} if fc else None),
              spec('dimensions', f'{num(h)} × {num(w)} × {num(t)} mm'), spec('weight', f'{num(wt)} g'), spec('modelNumber', cph)]
    specs = [s for s in specs if s]
    models.append({
        'id': mid, 'verified': True, 'brand': 'OPPO', 'series': 'Find X', 'model': model, 'year': year,
        'name': {'ar': ar, 'en': 'OPPO ' + model, 'fr': 'OPPO ' + model}, 'region': region, 'regionModel': cph, 'onOfficialRegionalStore': site == 'UAE',
        'sources': [{'label': f'OPPO {site} — specifications', 'url': url}], 'checkedAt': CHECKED,
        'colors': [{'name': c, 'hex': None, 'hexSource': None} for c in colors],
        'configs': [{'ramGb': r, 'storageGb': s} for r, s in cfgs],
        'variantMatrix': 'unconfirmed', 'variants': [], 'specs': specs,
    })
json.dump(models, open(os.path.join(out_dir, 'honor-oppo.json'), 'w'), ensure_ascii=False, indent=1)
print(len(models), 'honor/oppo models')
