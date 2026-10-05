import math
g=9.81
def mk(name,m,P,F0,a,b,c,mref,k=1.04,cscale=1.0,vP=None):
    # a,b,c daN/t with V km/h -> SI for mass mref (aero term not scaled with mass)
    A=a*10*m; B=b*10*m*3.6; C=c*10*mref*12.96*cscale
    return dict(name=name,m=m*1e3,P=P*1e3,F0=F0*1e3,A=A,B=B,C=C,k=k)
T=[mk("Duplex 8800kW 212kN m=424",424,8800,212,0.6325,0.00755,0.0001244,430),
   mk("Duplex vide m=390",390,8800,212,0.6325,0.00755,0.0001244,430),
   mk("Dasye 9280kW 220kN m=430",430,9280,220,0.6325,0.00755,0.0001244,430),
   mk("POS 9280kW 220kN m=420",420,9280,220,0.6405,0.00755,0.0001214,420),
   mk("TGV M 7760kW 244kN m=460 C-13%",460,7760,244,0.6325,0.00755,0.0001244,430,cscale=0.87),
   mk("TGV M vide m=413.5",413.5,7760,244,0.6325,0.00755,0.0001244,430,cscale=0.87)]
def R(t,v): return t['A']+t['B']*v+t['C']*v*v
def F(t,v): return min(t['F0'], t['P']/max(v,0.1))
def acc(t,v,i=0,trac=True): return ((F(t,v) if trac else 0)-R(t,v)-t['m']*g*i)/(t['k']*t['m'])
for t in T:
    print("==",t['name'],"A=%.0f N B=%.1f N/(m/s) C=%.3f N/(m/s)^2"%(t['A'],t['B'],t['C']),"v1=%.0f km/h"%(t['P']/t['F0']*3.6))
    print(" R kN @100/200/300/320:",["%.1f"%(R(t,v/3.6)/1e3) for v in (100,200,300,320)], "aero share@300 %.0f%%"%(100*t['C']*(300/3.6)**2/R(t,300/3.6)))
    print(" a traction @0/100/200/300/320:",["%.3f"%acc(t,v/3.6) for v in (0,100,200,300,320)])
    print(" coast decel @50/100/160/200/250/300/320:",["%.4f"%(-acc(t,v/3.6,trac=False)) for v in (50,100,160,200,250,300,320)])
    # accel run
    v=0;x=0;tt=0;dt=0.01;marks=[100,200,300,320];out=[]
    while marks and tt<3000:
        a=acc(t,v); 
        if a<=1e-4: break
        v+=a*dt;x+=v*dt;tt+=dt
        if v*3.6>=marks[0]: out.append("0-%d: %.0fs %.2fkm"%(marks.pop(0),tt,x/1e3))
    print(" ",out)
    # mean accel TSI
    for vm in (40,120,160):
        v=0;tt=0
        while v*3.6<vm: v+=acc(t,v)*dt;tt+=dt
        print("  mean a 0-%d = %.3f"%(vm,vm/3.6/tt),end=";")
    print()
    for i in (0,0.025,0.035):
        lo,hi=1,150
        for _ in range(60):
            mid=(lo+hi)/2
            if acc(t,mid,i)>0: lo=mid
            else: hi=mid
        print("  v_eq grade %.1f permil: %.0f km/h"%(i*1000,lo*3.6),end=";")
    print()
    # entering 35 permil ramp at 300 (or 270) full power: speed after L km
    for v0 in (300,270):
        v=v0/3.6;x=0;res=[]
        for L in (1,2,3,5):
            while x<L*1e3: v+=acc(t,v,0.035)*dt; x+=v*dt
            res.append("%dkm:%.0f"%(L,v*3.6))
        print("  35permil from %d:"%v0,res)
    # coasting from 300 on level: time/dist to 200 & 100
    v=300/3.6;x=0;tt=0;res=[]
    for vt in (250,200,100):
        while v*3.6>vt: v+=acc(t,v,trac=False)*dt;x+=v*dt;tt+=dt
        res.append("->%d: %.0fs %.1fkm"%(vt,tt,x/1e3))
    print("  coast from 300:",res)
