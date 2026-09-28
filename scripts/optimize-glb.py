#!/usr/bin/env python3
"""
Optimise un GLB pour le web sans toucher à la géométrie ni aux matériaux :
  - réduit les textures au-delà de --max (défaut 1024 px) ;
  - ré-encode en JPEG (qualité 85) les images sans transparence, garde PNG sinon ;
  - reconstruit le buffer binaire (alignement 4 octets).
Les images KTX2/WebP (extensions) sont laissées telles quelles.

Usage : python3 scripts/optimize-glb.py entree.glb sortie.glb [--max 1024]
"""
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2, 'GLB 2.0 attendu'
    off = 12
    js, binc = None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc


def write_glb(path, js, binc):
    jbytes = json.dumps(js, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    jbytes += b' ' * ((4 - len(jbytes) % 4) % 4)
    binc += b'\0' * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jbytes) + (8 + len(binc) if binc else 0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jbytes), 0x4E4F534A) + jbytes)
        if binc:
            f.write(struct.pack('<II', len(binc), 0x004E4942) + binc)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    max_size = int(sys.argv[sys.argv.index('--max') + 1]) if '--max' in sys.argv else 1024
    js, binc = read_glb(src)
    views = js.get('bufferViews', [])
    replaced = {}
    for img in js.get('images', []):
        bv = img.get('bufferView')
        mime = img.get('mimeType', '')
        if bv is None or mime not in ('image/png', 'image/jpeg'):
            continue
        v = views[bv]
        raw = binc[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        im = Image.open(io.BytesIO(raw))
        im.load()
        has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
        if has_alpha:
            alpha = im.convert('RGBA').getchannel('A')
            has_alpha = alpha.getextrema()[0] < 255
        w, h = im.size
        scale = min(1.0, max_size / max(w, h))
        if scale < 1:
            im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        out = io.BytesIO()
        if has_alpha:
            im.convert('RGBA').save(out, 'PNG', optimize=True)
            new_mime = 'image/png'
        else:
            im.convert('RGB').save(out, 'JPEG', quality=85, optimize=True)
            new_mime = 'image/jpeg'
        if len(out.getvalue()) < len(raw) or scale < 1:
            replaced[bv] = out.getvalue()
            img['mimeType'] = new_mime
    # Reconstruit le buffer : chaque vue est recopiée (ou remplacée), alignée sur 4 octets.
    new_bin = bytearray()
    for i, v in enumerate(views):
        if v.get('buffer', 0) != 0:
            continue
        chunk = replaced.get(i) or binc[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        new_bin += b'\0' * ((4 - len(new_bin) % 4) % 4)
        v['byteOffset'] = len(new_bin)
        v['byteLength'] = len(chunk)
        new_bin += chunk
    js['buffers'][0]['byteLength'] = len(new_bin)
    write_glb(dst, js, bytes(new_bin))
    print(f'{src} → {dst} : {len(open(src, "rb").read()) / 1e6:.2f} Mo → {len(open(dst, "rb").read()) / 1e6:.2f} Mo ({len(replaced)} images)')


if __name__ == '__main__':
    main()
