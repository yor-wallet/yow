"""Extract structured facts from Apple "Tech Specs" support pages (text dumps). stdlib only.
Usage: python3 -I apple_extract.py <raw_dir> <out_json>"""
import json, re, sys, os

HEADERS = ['Finish', 'Capacity', 'Size and Weight', 'Display', 'Outer Display', 'Inner Display', 'Cover Display', 'Main Display',
           'Splash, Water, and Dust Resistant', 'Apple Intelligence', 'Apple Intelligence and Siri AI', 'Chip', 'Camera', 'Video Recording',
           'Front Camera', 'TrueDepth Camera', 'Inner Camera', 'Outer Camera', 'Power and Battery', 'MagSafe', 'Face ID', 'Touch ID', 'Peace of Mind', 'Safety',
           'Cellular and Wireless', 'Location', 'External Buttons and Connectors', 'Charging and Expansion', 'MagSafe and Wireless Charging',
           'Sensors', 'SIM Card', 'Apple Pay', 'Video Calling', 'Audio Calling', 'Audio Playback', 'Video Playback', 'Siri',
           'Operating System', 'Privacy', 'Accessibility', 'Built-in Apps', 'Free Apps from Apple', 'Headphones', 'Rating for Hearing Aids',
           'Mail Attachment Support', 'System Requirements', 'Environmental Requirements', 'Languages', 'In the Box', 'iPhone and the Environment',
           'Action button features', 'Camera controls']
HSET = {h.lower(): h for h in HEADERS}

def sections(lines):
    out, cur = {}, None
    for ln in lines:
        s = ln.strip()
        key = re.sub(r'\d+$', '', s).strip().lower()
        if key in HSET and len(s) < 60:
            cur = HSET[key]
            out.setdefault(cur, [])
            continue
        if cur: out[cur].append(s)
    return out

def norm(s):
    return s.replace('‑', '-').replace('‐', '-').replace('\xa0', ' ').strip()

def extract(path):
    lines = [norm(l) for l in open(path, encoding='utf-8').read().split('\n') if l.strip()]
    title = next((l for l in lines if l.endswith('- Tech Specs') or 'Technical Specifications' in l), '')
    year = next((re.search(r'(\d{4})', l).group(1) for l in lines if l.startswith('Year introduced')), None)
    sec = sections(lines)
    r = {'title': title, 'year': int(year) if year else None, 'sections': sorted(sec.keys())}
    fin = sec.get('Finish', [])
    r['finishLines'] = fin[:8]
    r['capacity'] = [c for c in sec.get('Capacity', []) if re.fullmatch(r'\d+\s?(GB|TB)', c)]
    r['sizeWeight'] = sec.get('Size and Weight', [])[:12]
    for dkey in ('Display', 'Outer Display', 'Inner Display', 'Cover Display', 'Main Display'):
        if dkey in sec: r[dkey] = sec[dkey][:16]
    r['water'] = sec.get('Splash, Water, and Dust Resistant', [])[:2]
    r['chip'] = sec.get('Chip', [])[:6]
    cam = sec.get('Camera', [])
    r['cameraHead'] = cam[:1]
    r['cameraLenses'] = [l for l in cam if re.match(r'^\d+MP [^:]{3,110}:', l)]
    r['cameraAlso'] = [l for l in cam if l.startswith('Also enables')]
    for fkey in ('Front Camera', 'TrueDepth Camera', 'Inner Camera', 'Outer Camera'):
        if fkey in sec: r[fkey] = [l for l in sec[fkey] if re.search(r'MP|aperture|Outer|Inner', l)][:6]
    r['battery'] = sec.get('Power and Battery', [])[:22]
    r['magsafe'] = (sec.get('MagSafe and Wireless Charging', []) + sec.get('MagSafe', []))[:8]
    cw = sec.get('Cellular and Wireless', [])
    r['wireless'] = [l for l in cw if re.match(r'^(5G|Gigabit|LTE|Wi-Fi|Bluetooth|NFC|Ultra Wideband|Apple (second|N1|C\d)|Second-generation Ultra|Thread|Express Cards|Emergency SOS)', l) and 'Bands' not in l][:14]
    r['connector'] = [l for l in sec.get('External Buttons and Connectors', []) if 'connector' in l.lower()][:2]
    r['charging'] = sec.get('Charging and Expansion', [])[:8]
    r['sim'] = sec.get('SIM Card', [])[:5]
    r['os'] = sec.get('Operating System', [])[:2]
    r['box'] = sec.get('In the Box', [])[:6]
    return r

if __name__ == '__main__':
    raw_dir, out = sys.argv[1], sys.argv[2]
    res = {}
    for f in sorted(os.listdir(raw_dir)):
        if f.startswith('apple-specs-') and f.endswith('.txt'):
            res[f[len('apple-specs-'):-4]] = extract(os.path.join(raw_dir, f))
    json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
    print(len(res), 'models')
