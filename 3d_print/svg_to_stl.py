import sys, numpy as np, trimesh
from svgpathtools import svg2paths
from shapely.geometry import Polygon
from shapely.ops import unary_union
svg, out, width, thick = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
paths,_ = svg2paths(svg)
polys=[]
for p in paths:
    for sp in p.continuous_subpaths():
        pts=[]
        for seg in sp:
            n=max(4,int(seg.length()/0.6))
            pts += [seg.point(t) for t in np.linspace(0,1,n,endpoint=False)]
        xy=np.array([[z.real,-z.imag] for z in pts])
        if len(xy)<3: continue
        g=Polygon(xy).buffer(0)
        if g.area>0.05: polys.append(g)
polys.sort(key=lambda g:-g.area)
shape=None
for g in polys:   # even-odd: كل مسار يقلب المنطقة
    shape = g if shape is None else shape.symmetric_difference(g)
shape=shape.buffer(0.15).buffer(-0.15)   # ازالة الشظايا الدقيقة
minx,miny,maxx,maxy=shape.bounds; s=width/(maxx-minx)
from shapely import affinity
shape=affinity.translate(affinity.scale(shape,s,s,origin=(0,0)),-minx*s,-miny*s)
ink=shape.buffer(0.2)                                   # تغليظ الخطوط الرفيعة
sil=unary_union([Polygon(h.exterior) for g in polys for h in (g.geoms if hasattr(g,"geoms") else [g])]).buffer(0.8).buffer(-0.8)
sil=affinity.translate(affinity.scale(sil,s,s,origin=(0,0)),-minx*s,-miny*s)
base_t, ink_t = thick, 1.0
def ext(g,h,z):
    gs=list(g.geoms) if hasattr(g,'geoms') else [g]
    ms=[]
    for x in gs:
        if x.area<0.3: continue
        q=trimesh.creation.extrude_polygon(x,h); q.apply_translation([0,0,z])
        if q.is_volume: ms.append(q)
    return ms
parts=ext(sil,base_t,0)+ext(ink.intersection(sil.buffer(0.2)),ink_t,base_t-0.2)
m=trimesh.boolean.union(parts,engine='manifold')
m.export(out)
print(out,'size',m.extents,'watertight',m.is_watertight,'components',len(m.split(only_watertight=False)),'vol cm3',m.volume/1000)
