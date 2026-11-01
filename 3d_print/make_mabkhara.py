import numpy as np, struct, sys
# مقطع الشكل بالبكسل من الصورة (y من الأعلى, نصف القطر)
S = 100.0/570.0            # الارتفاع النهائي 100 مم
Y0, Y1 = 80, 650
def prof_px(y):
    if y < 150:   return np.interp(y,[80,150],[4,9])        # الإبرة
    if y < 165:   return np.interp(y,[150,165],[9,16])
    if y <= 330:  return 155*np.sqrt(max(0,1-((330-y)/165)**2)) if y>=205 else max(155*np.sqrt(max(0,1-((330-y)/165)**2)), 16*(205-y)/40)
    ys=[330,333,345,360,375,390,405,420,440,480,500,520,545,560,600,625,636,650]
    rs=[155,177,177,150,140,125,105, 65, 45, 40, 55, 60, 45, 45, 80,130,185,185]
    return np.interp(y,ys,rs)
NZ, NT = 360, 360
ys = np.linspace(Y1, Y0, NZ)                      # من القاعدة إلى القمة
th = np.linspace(0, 2*np.pi, NT, endpoint=False)
R = np.zeros((NZ, NT))
for i,y in enumerate(ys):
    R[i,:] = prof_px(y)
# النوافذ المقوّسة الغائرة (8 حول القبة)
NW, HALF, DEPTH = 8, np.radians(13), 7   # العمق بالبكسل (~1.2مم)
for i,y in enumerate(ys):
    if 285 <= y <= 330:
        for j,t in enumerate(th):
            d = (t + np.pi/NW) % (2*np.pi/NW) - np.pi/NW
            u = abs(d)/HALF
            if u < 1 and y > 285 + 10*(1-np.sqrt(1-u*u)):
                R[i,j] -= DEPTH
R[0,:] = R[0,:]; R[-1,:] = 0.0                    # القمة نقطة
R *= S
Z = (Y1 - ys) * S
V = []
for i in range(NZ):
    for j in range(NT):
        V.append((R[i,j]*np.cos(th[j]), R[i,j]*np.sin(th[j]), Z[i]))
V = np.array(V); base_c = len(V); V = np.vstack([V, [0,0,0]])
F = []
idx = lambda i,j: i*NT + (j%NT)
for i in range(NZ-1):
    for j in range(NT):
        a,b,c,d = idx(i,j), idx(i,j+1), idx(i+1,j+1), idx(i+1,j)
        F += [(a,b,c),(a,c,d)]
for j in range(NT):                                 # غطاء القاعدة
    F.append((base_c, idx(0,j+1), idx(0,j)))
F = np.array(F)
# إزالة المثلثات المنحلّة (القمة)
P = V[F]; n = np.cross(P[:,1]-P[:,0], P[:,2]-P[:,0]); keep = np.linalg.norm(n,axis=1) > 1e-12
F = F[keep]; P = V[F]; n = np.cross(P[:,1]-P[:,0], P[:,2]-P[:,0]); n /= np.linalg.norm(n,axis=1)[:,None]
out = sys.argv[1] if len(sys.argv)>1 else 'mabkhara.stl'
with open(out,'wb') as f:
    f.write(b'Mabkhara 3D print'.ljust(80,b' ')); f.write(struct.pack('<I',len(F)))
    for k in range(len(F)):
        f.write(struct.pack('<12fH',*n[k],*P[k].ravel(),0))
print(out, len(F), 'triangles; size mm:', V.max(0)-V.min(0))
