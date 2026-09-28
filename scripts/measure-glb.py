#!/usr/bin/env python3
"""
Mesure un GLB sans le rendre : boîte englobante d'origine (mètres, même calcul que
three.js Box3.setFromObject : coins des boîtes de géométrie transformés par la hiérarchie),
nombre de maillages, triangles, matériaux, textures, taille du fichier.

Usage : python3 scripts/measure-glb.py fichier.glb  → JSON sur la sortie standard
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from importlib import util

_spec = util.spec_from_file_location('opt', os.path.join(os.path.dirname(__file__), 'optimize-glb.py'))
_opt = util.module_from_spec(_spec)
_spec.loader.exec_module(_opt)


def mat_mul(a, b):
    return [sum(a[r + 4 * k] * b[k + 4 * c] for k in range(4)) for c in range(4) for r in range(4)]


def node_matrix(n):
    if 'matrix' in n:
        return list(n['matrix'])
    t = n.get('translation', [0, 0, 0])
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    r = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ]
    for c in range(3):
        for rr in range(3):
            r[rr + 4 * c] *= s[c]
    r[12], r[13], r[14] = t
    return r


def transform(m, p):
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]


def main():
    path = sys.argv[1]
    js, _ = _opt.read_glb(path)
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    tris = 0
    mesh_instances = 0
    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    scene = js.get('scenes', [{}])[js.get('scene', 0)]

    def visit(i, parent):
        nonlocal tris, mesh_instances
        n = js['nodes'][i]
        m = mat_mul(parent, node_matrix(n))
        if 'mesh' in n:
            mesh_instances += 1
            for pr in js['meshes'][n['mesh']]['primitives']:
                acc = js['accessors'][pr['attributes']['POSITION']]
                mn, mx = acc['min'], acc['max']
                for x in (mn[0], mx[0]):
                    for y in (mn[1], mx[1]):
                        for z in (mn[2], mx[2]):
                            p = transform(m, [x, y, z])
                            for k in range(3):
                                lo[k] = min(lo[k], p[k])
                                hi[k] = max(hi[k], p[k])
                mode = pr.get('mode', 4)
                count = js['accessors'][pr['indices']]['count'] if 'indices' in pr else acc['count']
                if mode == 4:
                    tris += count // 3
                elif mode in (5, 6):
                    tris += max(0, count - 2)
        for c in n.get('children', []):
            visit(c, m)

    for r in scene.get('nodes', []):
        visit(r, ident)
    rnd = lambda v: round(v, 5)
    print(json.dumps({
        'bounds': {'min': [rnd(v) for v in lo], 'max': [rnd(v) for v in hi]},
        'stats': {
            'meshes': mesh_instances,
            'triangles': tris,
            'materials': len(js.get('materials', [])),
            'textures': len(js.get('images', [])),
            'fileSize': os.path.getsize(path),
        },
    }))


if __name__ == '__main__':
    main()
