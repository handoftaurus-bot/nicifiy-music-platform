import { useEffect, useState } from "react";

let pushToast = null;

export function toast(msg){
  pushToast?.(String(msg || ""));
}

export function ToastHost(){
  const [items, setItems] = useState([]);

  useEffect(()=>{
    pushToast = (m)=>{
      const id = crypto.randomUUID();
      setItems(prev => [...prev, { id, m }]);
      setTimeout(()=> setItems(prev => prev.filter(x=>x.id!==id)), 3200);
    };
    return ()=>{ pushToast = null; };
  }, []);

  return (
    <div className="toastWrap" aria-live="polite" aria-atomic="true">
      {items.map(t => (
        <div key={t.id} className="toast">{t.m}</div>
      ))}
    </div>
  );
}
