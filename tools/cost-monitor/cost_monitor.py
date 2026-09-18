import json
import tkinter as tk
from tkinter import ttk
from urllib.request import Request, urlopen

SUPABASE_URL = "https://pcckllkvnootomwxsmlu.supabase.co"
PUBLISHABLE_KEY = "sb_publishable_dY1cvBi7OU0M3cF3qYusRQ_TpLo7b9Y"
REFRESH_MS = 3000

class Monitor(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("NearTime — Cost Monitor")
        self.geometry("1180x700")
        self.minsize(980, 560)
        self.vars = {k: tk.StringVar(value="—") for k in
                     ("searches","total","avg","max","discover","routes","status")}
        self.quota_vars = {}
        top=ttk.Frame(self,padding=12); top.pack(fill="x")
        labels=[("Searches","searches"),("Cost today","total"),("Avg/search","avg"),
                ("Max/search","max"),("Discover","discover"),("Routes","routes")]
        for i,(label,key) in enumerate(labels):
            box=ttk.LabelFrame(top,text=label,padding=8); box.grid(row=0,column=i,padx=4,sticky="nsew")
            ttk.Label(box,textvariable=self.vars[key],font=("Segoe UI",14,"bold")).pack()
            top.columnconfigure(i,weight=1)
        ttk.Label(self,textvariable=self.vars["status"],padding=(14,2)).pack(anchor="w")

        quota=ttk.LabelFrame(self,text="Free quota this month",padding=8)
        quota.pack(fill="x",padx=12,pady=(6,2))
        self.quota_frame=quota
        cols=("time","category","minutes","results","discover","routes","cost","status")
        self.tree=ttk.Treeview(self,columns=cols,show="headings")
        headings=("Time","Category","Min","Results","Discover","Routes","Cost NOK","Status")
        widths=(145,190,55,65,70,70,85,210)
        for c,h,w in zip(cols,headings,widths):
            self.tree.heading(c,text=h); self.tree.column(c,width=w,anchor="center")
        self.tree.column("category",anchor="w"); self.tree.column("status",anchor="w")
        self.tree.pack(fill="both",expand=True,padx=12,pady=10)
        ttk.Label(self,text="Estimated provider cost. TomTom billing remains the invoice source of truth.",
                  padding=(14,0,14,10)).pack(anchor="w")
        self.refresh()

    def fetch(self):
        req=Request(SUPABASE_URL+"/rest/v1/rpc/neartime_cost_monitor",
                    data=json.dumps({"p_limit":100}).encode(),
                    headers={"apikey":PUBLISHABLE_KEY,"Content-Type":"application/json"})
        with urlopen(req,timeout=8) as r: return json.loads(r.read().decode())

    def refresh(self):
        try:
            d=self.fetch(); t=d.get("today",{}); rows=d.get("recent",[])
            self.vars["searches"].set(str(t.get("searches",0)))
            self.vars["total"].set(f'{float(t.get("total_cost_nok",0)):.3f} NOK')
            self.vars["avg"].set(f'{float(t.get("avg_cost_nok",0)):.3f} NOK')
            self.vars["max"].set(f'{float(t.get("max_cost_nok",0)):.3f} NOK')
            self.vars["discover"].set(str(t.get("discover_calls",0)))
            self.vars["routes"].set(str(t.get("route_calls",0)))
            self.vars["status"].set("Live · refresh every 3 seconds")
            quotas=d.get("free_quotas",[]) or []
            for child in self.quota_frame.winfo_children():
                child.destroy()
            if quotas:
                for i,q in enumerate(quotas):
                    label=str(q.get("label",""))
                    used=int(q.get("used",0) or 0)
                    cap=int(q.get("free_cap",0) or 0)
                    remaining=int(q.get("remaining",0) or 0)
                    pct=float(q.get("percent_used",0) or 0)
                    box=ttk.Frame(self.quota_frame,padding=(6,2))
                    box.grid(row=0,column=i,sticky="nsew")
                    ttk.Label(box,text=label,font=("Segoe UI",9,"bold")).pack(anchor="w")
                    ttk.Label(
                        box,
                        text=f"{used:,} / {cap:,} · {pct:.1f}% · {remaining:,} left"
                    ).pack(anchor="w")
                    self.quota_frame.columnconfigure(i,weight=1)
            else:
                ttk.Label(self.quota_frame,text="No quota telemetry yet.").pack(anchor="w")

            self.tree.delete(*self.tree.get_children())
            for x in rows:
                stamp=str(x.get("occurred_at","")).replace("T"," ")[:19]
                self.tree.insert("", "end", values=(stamp,x.get("category",""),x.get("max_walk_minutes",""),
                    x.get("result_count",""),x.get("tomtom_discover_calls",""),x.get("tomtom_route_calls",""),
                    f'{float(x.get("estimated_cost_nok",0)):.3f}',x.get("result_status","")))
        except Exception as e:
            self.vars["status"].set("Read error: "+str(e))
        self.after(REFRESH_MS,self.refresh)

if __name__=="__main__":
    Monitor().mainloop()
