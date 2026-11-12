"""Apple: raw extraction → verified model entries. Usage: python3 -I apple_assemble.py <out_dir>"""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import spec, storages_value

out_dir = sys.argv[1]
raw = json.load(open(os.path.join(out_dir, 'apple-raw.json')))
HEX = json.load(open(os.path.join(out_dir, 'apple-finish-hex.json')))
CHECKED = '2026-11-12'
IDENTIFY = 'https://support.apple.com/en-om/108044'

# id → (series, Arabic name, spec page, Oman/GCC model number, SIM tray on the Oman model?, Apple Oman store page or None)
M = {
 'apple-iphone-14':         ('iPhone 14', 'آيفون 14', 'https://support.apple.com/en-om/111850', 'A2882', True, None),
 'apple-iphone-14-plus':    ('iPhone 14', 'آيفون 14 بلس', 'https://support.apple.com/en-om/111854', 'A2886', True, None),
 'apple-iphone-14-pro':     ('iPhone 14', 'آيفون 14 برو', 'https://support.apple.com/en-om/111849', 'A2890', True, None),
 'apple-iphone-14-pro-max': ('iPhone 14', 'آيفون 14 برو ماكس', 'https://support.apple.com/en-om/111846', 'A2894', True, None),
 'apple-iphone-15':         ('iPhone 15', 'آيفون 15', 'https://support.apple.com/en-om/111831', 'A3090', True, None),
 'apple-iphone-15-plus':    ('iPhone 15', 'آيفون 15 بلس', 'https://support.apple.com/en-om/111830', 'A3094', True, None),
 'apple-iphone-15-pro':     ('iPhone 15', 'آيفون 15 برو', 'https://support.apple.com/en-om/111829', 'A3102', True, None),
 'apple-iphone-15-pro-max': ('iPhone 15', 'آيفون 15 برو ماكس', 'https://support.apple.com/en-om/111828', 'A3106', True, None),
 'apple-iphone-16':         ('iPhone 16', 'آيفون 16', 'https://support.apple.com/en-om/121029', 'A3286', True, 'https://www.apple.com/om/iphone-16/specs/'),
 'apple-iphone-16-plus':    ('iPhone 16', 'آيفون 16 بلس', 'https://support.apple.com/en-om/121030', 'A3289', True, 'https://www.apple.com/om/iphone-16/specs/'),
 'apple-iphone-16-pro':     ('iPhone 16', 'آيفون 16 برو', 'https://support.apple.com/en-om/121031', 'A3292', True, None),
 'apple-iphone-16-pro-max': ('iPhone 16', 'آيفون 16 برو ماكس', 'https://support.apple.com/en-om/121032', 'A3295', True, None),
 'apple-iphone-16e':        ('iPhone 16', 'آيفون 16e', 'https://support.apple.com/en-om/122208', 'A3408', True, None),
 'apple-iphone-17':         ('iPhone 17', 'آيفون 17', 'https://support.apple.com/en-om/125089', 'A3519', False, 'https://www.apple.com/om/iphone-17/specs/'),
 'apple-iphone-17-pro':     ('iPhone 17', 'آيفون 17 برو', 'https://support.apple.com/en-om/125090', 'A3522', False, None),
 'apple-iphone-17-pro-max': ('iPhone 17', 'آيفون 17 برو ماكس', 'https://support.apple.com/en-om/125091', 'A3525', False, None),
 'apple-iphone-air':        ('iPhone Air', 'آيفون إير', 'https://support.apple.com/en-om/125092', 'A3260', False, 'https://www.apple.com/om/iphone-air/specs/'),
 'apple-iphone-17e':        ('iPhone 17', 'آيفون 17e', 'https://support.apple.com/en-om/126470', 'A3575', False, 'https://www.apple.com/om/iphone-17e/specs/'),
 'apple-iphone-18-pro':     ('iPhone 18', 'آيفون 18 برو', 'https://support.apple.com/en-om/148590', 'A3713', False, 'https://www.apple.com/om/iphone-18-pro/specs/'),
 'apple-iphone-18-pro-max': ('iPhone 18', 'آيفون 18 برو ماكس', 'https://support.apple.com/en-om/148591', 'A3716', False, 'https://www.apple.com/om/iphone-18-pro/specs/'),
 'apple-iphone-duo':        ('iPhone Duo', 'آيفون ديو', 'https://support.apple.com/en-om/148588', 'A3719', False, 'https://www.apple.com/om/iphone-duo/specs/'),
}

# official swatch variable per (model group, colour)
def hex_for(mid, color):
    c = color.lower()
    key = None
    if mid in ('apple-iphone-18-pro', 'apple-iphone-18-pro-max'):
        key = {'black': 'iphone18pro-black', 'silver': 'iphone18pro-white', 'glacier': 'iphone18pro-blue', 'burgundy': 'iphone18pro-red'}.get(c)
    elif mid == 'apple-iphone-duo':
        key = {'night sky': 'iphoneduo-night-sky', 'star white': 'iphoneduo-star-white'}.get(c)
    elif mid == 'apple-iphone-17e':
        key = {'black': 'iphone-17e-black', 'white': 'iphone-17e-white', 'soft pink': 'iphone-17e-pink'}.get(c)
    elif mid == 'apple-iphone-air':
        key = {'space black': 'iphone-air-black', 'cloud white': 'iphone-air-white', 'light gold': 'iphone-air-gold', 'sky blue': 'iphone-air-blue'}.get(c)
    elif mid in ('apple-iphone-17-pro', 'apple-iphone-17-pro-max'):
        key = {'silver': 'iphone-17-pro-silver', 'cosmic orange': 'iphone-17-pro-cosmic-orange', 'deep blue': 'iphone-17-pro-deep-blue'}.get(c)
    elif mid in ('apple-iphone-15', 'apple-iphone-15-plus'):
        key = {'black': 'black', 'blue': 'iphone-15-blue', 'green': 'iphone-15-green', 'yellow': 'iphone-15-yellow', 'pink': 'iphone-15-pink'}.get(c)
    elif mid in ('apple-iphone-14', 'apple-iphone-14-plus'):
        key = {'midnight': 'midnight', 'starlight': 'starlight', '(product)red': 'product-red', 'purple': 'purple', 'yellow': 'yellow'}.get(c)  # 14 "Blue": no dedicated variable
    else:
        key = c.replace(' ', '-')
    if key and key in HEX:
        h = HEX[key]
        if len(h) == 4: h = '#' + ''.join(ch * 2 for ch in h[1:])
        return h.lower(), 'official'
    return None, None

INDICATIVE = {('apple-iphone-14', 'blue'): '#a0b4c7', ('apple-iphone-14-plus', 'blue'): '#a0b4c7'}

def title_color(c):
    c = c.strip()
    if c.upper() == '(PRODUCT)RED': return '(PRODUCT)RED'
    return ' '.join(w if w.isupper() else w[:1].upper() + w[1:] for w in c.split(' '))

def gb(cap):
    m = re.fullmatch(r'(\d+)\s?(GB|TB)', cap)
    return int(m.group(1)) * (1024 if m.group(2) == 'TB' else 1)

MAT = {
 'Ceramic Shield front, Glass back and aluminum design': ('Ceramic Shield front, glass back, aluminium frame', 'Face avant Ceramic Shield, dos en verre, châssis en aluminium', 'واجهة Ceramic Shield، ظهر زجاجي، إطار من الألمنيوم'),
 'Ceramic Shield front, Textured matte glass back and stainless steel design': ('Ceramic Shield front, textured matte glass back, stainless steel frame', 'Face avant Ceramic Shield, dos en verre mat texturé, châssis en acier inoxydable', 'واجهة Ceramic Shield، ظهر زجاجي مطفي، إطار من الفولاذ المقاوم للصدأ'),
}

def mm(line):
    m = re.search(r'\(([\d.]+) mm\)', line)
    return m.group(1) if m else None

def dims(sw):
    def block(lines):
        w = h = d = g = None
        for l in lines:
            if l.startswith('Width'): w = mm(l)
            elif l.startswith('Height'): h = mm(l)
            elif l.startswith('Depth'): d = mm(l)
            elif l.startswith('Weight'):
                m = re.search(r'\((\d+) grams\)', l); g = m.group(1) if m else None
        return (h, w, d, g)
    if 'Open' in sw and 'Closed' in sw:
        o = block(sw[sw.index('Open') + 1: sw.index('Closed')]); c = block(sw[sw.index('Closed') + 1:])
        return {'open': o, 'closed': c}
    return {'single': block(sw)}

def display_value(lines):
    size = next((re.search(r'([\d.]+)-inch', l).group(1) for l in lines if re.search(r'[\d.]+-inch', l)), None)
    res = next((re.search(r'(\d+)-by-(\d+)-pixel resolution at (\d+) ppi', l) for l in lines if 'pixel resolution' in l), None)
    promo = any('ProMotion' in l for l in lines)
    parts = [f'{size}″ Super Retina XDR OLED']
    if res: parts.append(f'{res.group(1)} × {res.group(2)} px ({res.group(3)} ppi)')
    if promo: parts.append('ProMotion 120 Hz')
    return ' · '.join(parts)

def chip_value(lines):
    name = lines[0].replace(' chip', '').strip()
    cpu = next((re.search(r'(\d+)-core CPU', l).group(1) for l in lines if 'core CPU' in l), None)
    gpu = next((re.search(r'(\d+)-core GPU', l).group(1) for l in lines if 'core GPU' in l), None)
    if cpu and gpu:
        return {'en': f'{name} — {cpu}-core CPU, {gpu}-core GPU', 'fr': f'{name} — CPU {cpu} cœurs, GPU {gpu} cœurs', 'ar': f'{name} — معالج مركزي {cpu} أنوية، معالج رسومات {gpu} أنوية'}
    return name

def lens(l):
    name, rest = l.split(':', 1)
    aps = re.findall(r'ƒ/[\d.]+', name) or re.findall(r'ƒ/[\d.]+', rest)
    name = re.sub(r' with variable aperture.*$', '', name).strip()
    name = re.sub(r'\s*\([^)]*\)', '', name).strip()
    name = re.sub(r'^(\d+)MP', r'\1 MP', name)
    zoom = re.search(r'\((\d+)x\)', rest)
    if zoom and 'Telephoto' in name: name += f' {zoom.group(1)}x'
    ap = (f'{aps[0]}–{aps[-1]}' if len(aps) > 1 and 'variable' in l else aps[0]) if aps else None
    return f'{name} ({ap})' if ap else name

def front_value(v):
    for k in ('TrueDepth Camera', 'Front Camera'):
        ls = v.get(k) or []
        mp = next((l for l in ls if re.match(r'^\d+MP', l)), None)
        if mp:
            ap = next((re.search(r'ƒ/[\d.]+', l).group(0) for l in ls if 'aperture' in l), None)
            name = re.sub(r'^(\d+)MP', r'\1 MP', mp).replace(' camera', '')
            return f'{name} ({ap})' if ap else name
    return None

def battery_value(v, mid):
    text = ' | '.join(v['battery'])
    if mid == 'apple-iphone-duo':
        m = re.search(r'Up to (\d+) hours when using the outer display\d* \| Up to (\d+) hours when using the inner display', text)
        if m:
            return {'en': f'Video playback: up to {m.group(1)} h on the outer display, up to {m.group(2)} h on the inner display',
                    'fr': f'Lecture vidéo : jusqu’à {m.group(1)} h sur l’écran externe, jusqu’à {m.group(2)} h sur l’écran interne',
                    'ar': f'تشغيل الفيديو: حتى {m.group(1)} ساعة على الشاشة الخارجية وحتى {m.group(2)} ساعة على الشاشة الداخلية'}
        return None
    m = re.search(r'Video playback:? ?\|? ?Up to (\d+) hours', text)
    if not m: return None
    n = m.group(1)
    return {'en': f'Up to {n} hours of video playback', 'fr': f'Jusqu’à {n} h de lecture vidéo', 'ar': f'حتى {n} ساعة من تشغيل الفيديو'}

def charging_value(v):
    text = ' | '.join(v['battery'] + v['magsafe'] + v['charging'] + v['connector'])
    usb_c = 'USB-C connector' in text
    conn = 'USB-C' if usb_c else 'Lightning'
    fast = re.search(r'Up to 50% charge in (?:around )?(\d+) minutes\d* (?:when using|with) (\d+)W', text)
    mag = re.search(r'MagSafe wireless charging up to (\d+)W', text)
    qi2 = re.search(r'Qi2 wireless charging up to ([\d.]+)W', text)
    qi = re.search(r'Qi wireless charging up to ([\d.]+)W', text)
    wl_generic = re.search(r'Wireless charging up to ([\d.]+)W', text)
    en, fr, ar = [conn], [conn], [conn]
    if fast:
        en.append(f'fast charging: up to 50% in about {fast.group(1)} min with a {fast.group(2)} W or higher adapter (sold separately)')
        fr.append(f'recharge rapide : jusqu’à 50 % en {fast.group(1)} min environ avec un adaptateur de {fast.group(2)} W ou plus (vendu séparément)')
        ar.append(f'شحن سريع: حتى 50% خلال نحو {fast.group(1)} دقيقة بمحوّل بقدرة {fast.group(2)} واط أو أعلى (يُباع منفصلًا)')
    if mag:
        en.append(f'MagSafe wireless charging up to {mag.group(1)} W'); fr.append(f'recharge sans fil MagSafe jusqu’à {mag.group(1)} W'); ar.append(f'شحن لاسلكي MagSafe حتى {mag.group(1)} واط')
    if qi2:
        en.append(f'Qi2 up to {qi2.group(1)} W'); fr.append(f'Qi2 jusqu’à {qi2.group(1)} W'); ar.append(f'Qi2 حتى {qi2.group(1)} واط')
    elif qi:
        en.append(f'Qi up to {qi.group(1)} W'); fr.append(f'Qi jusqu’à {qi.group(1)} W'); ar.append(f'Qi حتى {qi.group(1)} واط')
    if not mag and not qi2 and not qi and wl_generic:
        en.append(f'wireless charging up to {wl_generic.group(1)} W'); fr.append(f'recharge sans fil jusqu’à {wl_generic.group(1)} W'); ar.append(f'شحن لاسلكي حتى {wl_generic.group(1)} واط')
    return {'en': ' · '.join(en), 'fr': ' · '.join(fr), 'ar': ' · '.join(ar)}

def connectivity_value(v):
    w = ' | '.join(v['wireless'])
    parts = []
    if '5G' in w: parts.append('5G')
    m = re.search(r'Wi-Fi (\d[\dE]*)', w)
    if m: parts.append(f'Wi‑Fi {m.group(1)}')
    m = re.search(r'Bluetooth ([\d.]+)', w)
    if m: parts.append(f'Bluetooth {m.group(1)}')
    if 'NFC' in w: parts.append('NFC')
    if 'Ultra Wideband' in w: parts.append('Ultra Wideband')
    if 'Thread' in w: parts.append('Thread')
    return ' · '.join(parts)

def water_value(v):
    t = ' '.join(v['water'])
    m = re.search(r'Rated (IP\d+) \(maximum depth of (\d+) meters up to (\d+) minutes\)', t)
    if not m: return None
    return {'en': f'{m.group(1)} — up to {m.group(2)} m for {m.group(3)} minutes', 'fr': f'{m.group(1)} — jusqu’à {m.group(2)} m pendant {m.group(3)} minutes', 'ar': f'{m.group(1)} — حتى عمق {m.group(2)} أمتار لمدة {m.group(3)} دقيقة'}

def box_value(v, model):
    items = [l for l in v['box'] if len(l) <= 40]
    en, fr, ar = [], [], []
    for it in items:
        if it == model or it.startswith('iPhone'):
            en.append(model); fr.append(model); ar.append(model)
        elif it == 'USB-C Charge Cable (1 m)':
            en.append('USB‑C charge cable (1 m)'); fr.append('câble de charge USB‑C (1 m)'); ar.append('كابل شحن USB‑C (1 متر)')
        elif it == 'USB-C to Lightning Cable':
            en.append('USB‑C to Lightning cable'); fr.append('câble USB‑C vers Lightning'); ar.append('كابل USB‑C إلى Lightning')
        elif it == 'Documentation':
            en.append('documentation'); fr.append('documentation'); ar.append('الوثائق')
        else:
            raise SystemExit(f'unknown box item for {model}: {it!r}')
    note = {'en': ' (no power adapter or headphones included)', 'fr': ' (adaptateur secteur et écouteurs non inclus)', 'ar': ' (لا يتضمن محوّل الطاقة أو السماعات)'}
    return {'en': ', '.join(en) + note['en'], 'fr': ', '.join(fr) + note['fr'], 'ar': '، '.join(ar) + note['ar']}

def materials_value(fin_rest):
    if not fin_rest: return None
    D = {
     'aluminum unibody design': ('aluminium unibody', 'monocoque en aluminium', 'هيكل أحادي من الألمنيوم'),
     'aluminum design': ('aluminium frame', 'châssis en aluminium', 'إطار من الألمنيوم'),
     'titanium design': ('titanium frame', 'châssis en titane', 'إطار من التيتانيوم'),
     'titanium foldable design': ('titanium foldable design', 'design pliable en titane', 'تصميم قابل للطي من التيتانيوم'),
     'stainless steel design': ('stainless steel frame', 'châssis en acier inoxydable', 'إطار من الفولاذ المقاوم للصدأ'),
     'ceramic shield 2 front': ('Ceramic Shield 2 front', 'face avant Ceramic Shield 2', 'واجهة Ceramic Shield 2'),
     'ceramic shield front': ('Ceramic Shield front', 'face avant Ceramic Shield', 'واجهة Ceramic Shield'),
     'latest-generation ceramic shield front': ('latest-generation Ceramic Shield front', 'face avant Ceramic Shield de dernière génération', 'واجهة Ceramic Shield من أحدث جيل'),
     'ceramic shield back': ('Ceramic Shield back', 'dos Ceramic Shield', 'ظهر Ceramic Shield'),
     'color-infused glass back': ('colour-infused glass back', 'dos en verre teinté dans la masse', 'ظهر زجاجي ملوّن'),
     'textured matte glass back': ('textured matte glass back', 'dos en verre mat texturé', 'ظهر زجاجي مطفي'),
     'glass back': ('glass back', 'dos en verre', 'ظهر زجاجي'),
    }
    phrases = []
    for l in fin_rest:
        l = re.sub(r'\s*\([^)]*\)', '', l)
        for part in l.split(','):
            for sub in part.split(' and '):
                sub = sub.strip()
                if sub: phrases.append(sub)
    en, fr, ar = [], [], []
    for ph in phrases:
        k = ph.lower()
        if k not in D: raise SystemExit(f'unknown material phrase: {ph!r}')
        e, f, a_ = D[k]; en.append(e); fr.append(f); ar.append(a_)
    cap = lambda t: t[:1].upper() + t[1:]
    return {'en': cap(', '.join(en)), 'fr': cap(', '.join(fr)), 'ar': '، '.join(ar)}

models = []
for mid, (series, name_ar, spec_url, model_no, sim_tray, om_url) in M.items():
    v = raw[mid]
    model = v['title'].split(' - ')[0].strip()
    fin = v['finishLines']
    kw = ('design', 'Shield', 'glass')
    first = next(i for i, l in enumerate(fin) if any(k in l for k in kw))
    colors = [title_color(c) for l in fin[:first] for c in l.split(',') if c.strip()]
    rest = fin[first:]
    storages = sorted(gb(c) for c in v['capacity'])
    color_objs = []
    for c in colors:
        h, src = hex_for(mid, c)
        if not h:
            h = INDICATIVE.get((mid, c.lower())); src = 'indicative'
        if not h: raise SystemExit(f'no hex for {mid} {c}')
        color_objs.append({'name': c, 'hex': h, 'hexSource': src})
    d = dims(v['sizeWeight'])
    specs = []
    if 'Outer Display' in v:
        specs.append(spec('display', display_value(v['Inner Display']).replace('OLED', 'OLED (foldable)') if False else display_value(v['Inner Display'])))
        specs.append(spec('coverDisplay', display_value(v['Outer Display'] )))
    else:
        specs.append(spec('display', display_value(v['Display'])))
    specs.append(spec('chip', chip_value(v['chip'])))
    specs.append(spec('storage', storages_value(storages)))
    specs.append(spec('rearCamera', ' · '.join(lens(l) for l in v['cameraLenses'])))
    specs.append(spec('frontCamera', front_value(v)))
    specs.append(spec('battery', battery_value(v, mid)))
    specs.append(spec('charging', charging_value(v)))
    specs.append(spec('resistance', water_value(v)))
    if sim_tray:
        specs.append(spec('sim', {'en': 'Dual SIM: nano‑SIM + eSIM (Oman / GCC model)', 'fr': 'Double SIM : nano‑SIM + eSIM (modèle Oman / CCG)', 'ar': 'شريحتان: nano‑SIM + eSIM (طراز عُمان / الخليج)'}))
    else:
        specs.append(spec('sim', {'en': 'eSIM only — no physical SIM tray on the Oman / GCC model', 'fr': 'eSIM uniquement — pas de tiroir SIM physique sur le modèle Oman / CCG', 'ar': 'eSIM فقط — لا يوجد درج شريحة فعلية في طراز عُمان / الخليج'}))
    specs.append(spec('connectivity', connectivity_value(v)))
    if 'single' in d:
        h, w, dp, g = d['single']
        specs.append(spec('dimensions', f'{h} × {w} × {dp} mm'))
        specs.append(spec('weight', f'{g} g'))
    else:
        (oh, ow, od, og), (ch, cw, cd, cg) = d['open'], d['closed']
        specs.append(spec('dimensions', {'en': f'Open: {oh} × {ow} × {od} mm · closed: {ch} × {cw} × {cd} mm', 'fr': f'Ouvert : {oh} × {ow} × {od} mm · fermé : {ch} × {cw} × {cd} mm', 'ar': f'مفتوح: {oh} × {ow} × {od} mm · مغلق: {ch} × {cw} × {cd} mm'}))
        specs.append(spec('weight', f'{og} g'))
    specs.append(spec('materials', materials_value(rest)))
    specs.append(spec('os', 'iOS'))
    specs.append(spec('modelNumber', model_no))
    specs.append(spec('inTheBox', box_value(v, model)))
    specs = [s for s in specs if s]
    sources = [{'label': f'Apple Support — {model} Tech Specs', 'url': spec_url}, {'label': 'Apple Support — Identify your iPhone model (Oman model numbers, SIM tray)', 'url': IDENTIFY}]
    if om_url: sources.append({'label': 'Apple (Oman) — Technical Specifications', 'url': om_url})
    models.append({
        'id': mid, 'verified': True, 'brand': 'Apple', 'series': series, 'model': model, 'year': v['year'],
        'name': {'ar': name_ar, 'en': model, 'fr': model}, 'region': 'GCC', 'regionModel': model_no,
        'onOfficialRegionalStore': bool(om_url),
        'sources': sources, 'checkedAt': CHECKED,
        'colors': color_objs,
        'variants': [{'color': c['name'], 'storageGb': s, 'ramGb': None, 'mpn': None} for c in color_objs for s in storages],
        'specs': specs,
    })
json.dump(models, open(os.path.join(out_dir, 'apple.json'), 'w'), ensure_ascii=False, indent=1)
print(len(models), 'apple models;', sum(len(m['variants']) for m in models), 'variants')
