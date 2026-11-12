"""Minimal HTML → text (stdlib only). Usage: python3 -I html2text.py <file>"""
import sys, re, html
from html.parser import HTMLParser

class T(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript', 'svg'): self.skip += 1
        if tag in ('p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'tr', 'br', 'section', 'dt', 'dd', 'td', 'th', 'ul', 'ol', 'table'): self.out.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript', 'svg'): self.skip = max(0, self.skip - 1)
        if tag in ('p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'tr', 'td', 'th', 'section', 'dt', 'dd'): self.out.append('\n')
    def handle_data(self, data):
        if not self.skip: self.out.append(data)

def to_text(raw):
    p = T(); p.feed(raw)
    text = ''.join(p.out)
    text = re.sub(r'[ \t\r\f\v\xa0]+', ' ', text)
    text = re.sub(r'\n\s*\n+', '\n', text)
    return text.strip()

if __name__ == '__main__':
    print(to_text(open(sys.argv[1], encoding='utf-8', errors='replace').read()))
