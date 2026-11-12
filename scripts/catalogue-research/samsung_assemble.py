"""Samsung (Samsung Gulf official catalogue API + spec API) → verified entries. python3 -I samsung_assemble.py <raw_dir> <out_dir>"""
import json, glob, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import spec, storages_value

raw_dir, out_dir = sys.argv[1], sys.argv[2]
CHECKED = '2026-11-12'
CAT = 'https://www.samsung.com/ae/smartphones/galaxy-s/'
PAGES = {
 'Galaxy S23': CAT, 'Galaxy S23+': CAT, 'Galaxy S23 Ultra': CAT,
 'Galaxy S24': 'https://www.samsung.com/ae/smartphones/galaxy-s24/specs/', 'Galaxy S24+': 'https://www.samsung.com/ae/smartphones/galaxy-s24/specs/', 'Galaxy S24 Ultra': 'https://www.samsung.com/ae/smartphones/galaxy-s24-ultra/specs/',
 'Galaxy S25': 'https://www.samsung.com/ae/smartphones/galaxy-s25/specs/', 'Galaxy S25+': 'https://www.samsung.com/ae/smartphones/galaxy-s25/specs/', 'Galaxy S25 Ultra': 'https://www.samsung.com/ae/smartphones/galaxy-s25-ultra/specs/',
 'Galaxy S26': 'https://www.samsung.com/ae/smartphones/galaxy-s26/specs/', 'Galaxy S26+': 'https://www.samsung.com/ae/smartphones/galaxy-s26/specs/', 'Galaxy S26 Ultra': 'https://www.samsung.com/ae/smartphones/galaxy-s26-ultra/specs/',
 'Galaxy Z Fold5': 'https://www.samsung.com/ae/smartphones/galaxy-z/', 'Galaxy Z Fold6': 'https://www.samsung.com/ae/smartphones/galaxy-z-fold6/specs/', 'Galaxy Z Fold7': 'https://www.samsung.com/ae/smartphones/galaxy-z-fold7/specs/',
}
IDS = {
 'Galaxy S23': ('samsung-galaxy-s23', 'Galaxy S23', 2023, 'جالاكسي S23'), 'Galaxy S23+': ('samsung-galaxy-s23plus', 'Galaxy S23', 2023, 'جالاكسي S23+'), 'Galaxy S23 Ultra': ('samsung-galaxy-s23-ultra', 'Galaxy S23', 2023, 'جالاكسي S23 ألترا'),
 'Galaxy S24': ('samsung-galaxy-s24', 'Galaxy S24', 2024, 'جالاكسي S24'), 'Galaxy S24+': ('samsung-galaxy-s24plus', 'Galaxy S24', 2024, 'جالاكسي S24+'), 'Galaxy S24 Ultra': ('samsung-galaxy-s24-ultra', 'Galaxy S24', 2024, 'جالاكسي S24 ألترا'),
 'Galaxy S25': ('samsung-galaxy-s25', 'Galaxy S25', 2025, 'جالاكسي S25'), 'Galaxy S25+': ('samsung-galaxy-s25plus', 'Galaxy S25', 2025, 'جالاكسي S25+'), 'Galaxy S25 Ultra': ('samsung-galaxy-s25-ultra', 'Galaxy S25', 2025, 'جالاكسي S25 ألترا'),
 'Galaxy S26': ('samsung-galaxy-s26', 'Galaxy S26', 2026, 'جالاكسي S26'), 'Galaxy S26+': ('samsung-galaxy-s26plus', 'Galaxy S26', 2026, 'جالاكسي S26+'), 'Galaxy S26 Ultra': ('samsung-galaxy-s26-ultra', 'Galaxy S26', 2026, 'جالاكسي S26 ألترا'),
 'Galaxy Z Fold5': ('samsung-galaxy-z-fold5', 'Galaxy Z Fold', 2023, 'جالاكسي Z فولد 5'), 'Galaxy Z Fold6': ('samsung-galaxy-z-fold6', 'Galaxy Z Fold', 2024, 'جالاكسي Z فولد 6'), 'Galaxy Z Fold7': ('samsung-galaxy-z-fold7', 'Galaxy Z Fold', 2025, 'جالاكسي Z فولد 7'),
}
NAMEFIX = {'phantomblack': 'Phantom Black', 'icyblue': 'Icy Blue', 'blueblack': 'Blue Black', 'coralred': 'Coral Red', 'pinkgold': 'Pink Gold', 'jetblack': 'Jet Black',
           'titanium whitesilver': 'Titanium White Silver', 'titanium silverblue': 'Titanium Silver Blue', 'titanium jetblack': 'Titanium Jet Black', 'titanium jadegreen': 'Titanium Jade Green',
           'titanium pinkgold': 'Titanium Pink Gold', 'titaniumblack': 'Titanium Black', 'titaniumgray': 'Titanium Gray'}
def cname(s):
    s = re.sub(r'\s+', ' ', (s or '').replace('\t', ' ')).strip()
    return NAMEFIX.get(s.lower(), s)

def facts(code):
    p = os.path.join(raw_dir, f'samsung-spec-{code}.json')
    if not os.path.exists(p): return None
    ml = json.load(open(p))['response']['resultData']['modelList']
    if not ml: return None
    out = {'_groups': []}
    for g in ml[0]['spec']['specItems']:
        out['_groups'].append(g['attrName'])
        for a in g.get('attrs') or []:
            out[a['attrName']] = a['attrValue']
    return out

fams = {}
for f in sorted(glob.glob(os.path.join(raw_dir, 'samsung-card-*.json'))):
    d = json.load(open(f))
    for fam in d['response']['resultData']['productList']:
        n = fam['fmyMarketingName']
        e = fams.setdefault(n, {'hex': {}, 'models': {}})
        for chip in fam.get('chipOptions') or []:
            if chip.get('fmyChipType') == 'COLOR':
                for o in chip.get('optionList', []):
                    nm = cname(o.get('optionLocalName') or o.get('optionName'))
                    if o.get('optionCode', '').startswith('#'): e['hex'][nm.lower().replace(' ', '')] = o['optionCode'].lower()
        for m in fam.get('modelList') or []:
            code = m['modelCode']
            if not code.endswith('MEA'): continue   # Middle East & Africa SKUs only
            chips = {c['fmyChipType']: (c.get('fmyChipLocalName') or c.get('fmyChipName') or '') for c in (m.get('fmyChipList') or [])}
            e['models'][code] = chips

def gbval(label):
    m = re.fullmatch(r'\s*(\d+)\s*(GB|TB)\s*', label)
    return int(m.group(1)) * (1024 if m.group(2) == 'TB' else 1)

def ghz(s): return re.findall(r'[\d.]+GHz', s or '')

models = []
for name, (mid, series, year, ar) in IDS.items():
    e = fams[name]
    ms = e['models']
    assert ms, name
    rows = []
    for code, chips in sorted(ms.items()):
        fc = facts(code)
        col = cname((fc or {}).get('Color') or chips.get('COLOR'))
        st = gbval(chips['MOBILE MEMORY'])
        ram = int(fc['Memory_(GB)']) if fc and fc.get('Memory_(GB)') else None
        rows.append((col, st, ram, code))
    # dedupe colours (case/space-insensitive)
    cols = []
    for col, *_ in rows:
        if col.lower().replace(' ', '') not in [c.lower().replace(' ', '') for c in cols]: cols.append(col)
    color_objs = []
    for c in cols:
        h = e['hex'].get(c.lower().replace(' ', '')) or e['hex'].get(re.sub(r'[^a-z]', '', c.lower()))
        if not h:
            # try matching a chip hex by squashed name
            for k, v in e['hex'].items():
                if re.sub(r'[^a-z]', '', k) == re.sub(r'[^a-z]', '', c.lower()): h = v
        color_objs.append({'name': c, 'hex': h, 'hexSource': 'official' if h else None})
    storages = sorted({r[1] for r in rows})
    # reference model for family-wide specs: the highest-storage MEA code with a spec
    ref = None
    for col, st, ram, code in sorted(rows, key=lambda r: -r[1]):
        ref = facts(code)
        if ref: break
    f = ref
    folding = 'Sub Display' in ' '.join(f.keys()) or 'Size (Sub_Display)' in f
    specs = []
    sz = lambda s: (re.search(r'\(([\d.]+)"\)', s or '') or [None, None])[1]
    mainsz, subsz = sz(f.get('Size (Main_Display)')), sz(f.get('Size (Sub_Display)'))
    def disp(size, res, tech, hz):
        res = (res or '').split(' (')[0].replace(' x ', ' × ')
        parts = [f'{size}″ {tech}' if tech else f'{size}″']
        if res: parts.append(f'{res} px')
        if hz: parts.append(hz.replace(' Hz', ' Hz') if 'Hz' in hz else f'{hz} Hz')
        return ' · '.join(parts)
    specs.append(spec('display', disp(mainsz, f.get('Resolution (Main Display)'), f.get('Technology (Main Display)'), f.get('Max Refresh Rate (Main Display)'))))
    if folding: specs.append(spec('coverDisplay', disp(subsz, f.get('Resolution (Sub Display)'), f.get('Technology (Sub Display)'), None)))
    ghzs = ghz(f.get('CPU Speed'))
    if ghzs and f.get('CPU Type'):
        specs.append(spec('chip', {'en': f"{f['CPU Type'].replace('-Core', '-core')} — up to {ghzs[0].replace('GHz', ' GHz')}", 'fr': f"{f['CPU Type'].replace('Octa-Core', 'Octa-cœur')} — jusqu’à {ghzs[0].replace('GHz', ' GHz')}", 'ar': f"ثماني الأنوية — حتى {ghzs[0].replace('GHz', ' GHz')}"}))
    rams = sorted({r[2] for r in rows if r[2]})
    if rams:
        specs.append(spec('memory', ' · '.join(f'{r} GB' for r in rams) if len(rams) > 1 else f'{rams[0]} GB'))
    specs.append(spec('storage', storages_value(storages)))
    mp = [re.sub(r'\.0$', '', x.strip().replace(' MP', '')) for x in (f.get('Rear Camera - Resolution (Multiple)') or '').split('+')]
    fn = [x.strip().replace('F', 'ƒ/') for x in (f.get('Rear Camera - F Number (Multiple)') or '').split(',')]
    if mp and mp[0]:
        specs.append(spec('rearCamera', ' · '.join(f'{m} MP' + (f' ({fn[i]})' if i < len(fn) and fn[i] else '') for i, m in enumerate(mp))))
    fm = re.sub(r'\.0$', '', (f.get('Front Camera - Resolution') or '').replace(' MP', ''))
    if fm:
        specs.append(spec('frontCamera', f"{fm} MP" + (f" ({f['Front Camera - F Number'].replace('F', 'ƒ/')})" if f.get('Front Camera - F Number') else '')))
    mah = f.get('Battery Capacity (mAh, Typical)')
    vid = f.get('Video Playback Time (Hours)') or f.get('Video Playback Time (Hours, Wireless)')
    if mah:
        v = {'en': f'{mah} mAh (typical)', 'fr': f'{mah} mAh (typique)', 'ar': f'{mah} مللي أمبير/ساعة (نموذجي)'}
        if vid:
            h = re.search(r'(\d+)', vid).group(1)
            v = {'en': v['en'] + f' · video playback up to {h} h', 'fr': v['fr'] + f' · lecture vidéo jusqu’à {h} h', 'ar': v['ar'] + f' · تشغيل الفيديو حتى {h} ساعة'}
        specs.append(spec('battery', v))
    sim_n, sim_t = f.get('Number of SIM'), f.get('SIM size')
    if sim_n and sim_t:
        if 'Embedded' in sim_t and 'Nano' in sim_t and 'Dual' in sim_n:
            specs.append(spec('sim', {'en': 'Dual SIM: nano‑SIM + eSIM', 'fr': 'Double SIM : nano‑SIM + eSIM', 'ar': 'شريحتان: nano‑SIM + eSIM'}))
        else:
            specs.append(spec('sim', f"{sim_n} · {sim_t}"))
    conn = []
    if f.get('Wi-Fi'): conn.append('Wi‑Fi 7' if re.search(r'/be\b', f['Wi-Fi']) else 'Wi‑Fi 6' if re.search(r'/ax\b', f['Wi-Fi']) else 'Wi‑Fi 5' if '/ac' in f['Wi-Fi'] else 'Wi‑Fi')
    if f.get('Bluetooth Version'): conn.append(f['Bluetooth Version'].replace('Bluetooth v', 'Bluetooth '))
    if f.get('NFC') == 'Yes': conn.append('NFC')
    if f.get('UWB (Ultra-Wideband)') == 'Yes': conn.append('UWB')
    if f.get('USB Interface'): conn.append(f['USB Interface'])
    if conn: specs.append(spec('connectivity', ' · '.join(conn)))
    dim = f.get('Dimension (HxWxD, mm)')
    if dim:
        d1 = dim.replace(' x ', ' × ')
        if f.get('Dimension when folded (HxWxD, mm)'):
            d2 = f['Dimension when folded (HxWxD, mm)'].replace(' x ', ' × ')
            specs.append(spec('dimensions', {'en': f'Open: {d1} mm · folded: {d2} mm', 'fr': f'Ouvert : {d1} mm · plié : {d2} mm', 'ar': f'مفتوح: {d1} mm · مطوي: {d2} mm'}))
        else:
            specs.append(spec('dimensions', f'{d1} mm'))
    if f.get('Weight (g)'): specs.append(spec('weight', f"{f['Weight (g)']} g"))
    if 'S Pen Support' in f['_groups']: specs.append(spec('stylus', {'en': 'S Pen supported', 'fr': 'Compatible S Pen', 'ar': 'يدعم قلم S Pen'}))
    if f.get('Security Update Period (Valid until)'): specs.append(spec('softwareSupport', f['Security Update Period (Valid until)']))
    specs.append(spec('modelNumber', ', '.join(sorted({c[:8] for c in ms}))))
    specs = [s for s in specs if s]
    variants = [{'color': col, 'storageGb': st, 'ramGb': ram, 'mpn': code} for col, st, ram, code in rows]
    # dedupe by (color, storage) keeping first
    seen, uniq = set(), []
    for v in variants:
        k = (v['color'].lower().replace(' ', ''), v['storageGb'])
        if k in seen: continue
        seen.add(k); uniq.append(v)
    models.append({
        'id': mid, 'verified': True, 'brand': 'Samsung', 'series': series, 'model': name, 'year': year,
        'name': {'ar': ar, 'en': name, 'fr': name}, 'region': 'GCC', 'regionModel': None, 'onOfficialRegionalStore': True,
        'sources': [{'label': 'Samsung Gulf — product catalogue and specifications', 'url': PAGES[name]}, {'label': 'Samsung Gulf — catalogue API (MEA model codes: SM-…MEA)', 'url': 'https://www.samsung.com/ae/smartphones/'}],
        'checkedAt': CHECKED, 'colors': color_objs, 'variants': uniq, 'specs': specs,
    })
json.dump(models, open(os.path.join(out_dir, 'samsung.json'), 'w'), ensure_ascii=False, indent=1)
print(len(models), 'samsung models;', sum(len(m['variants']) for m in models), 'variants')
