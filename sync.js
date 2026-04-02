
const Sync = (()=>{

const API="https://script.google.com/macros/s/AKfycbyZR6LEiStjcbwuMkPSu9WU5VogFWidS8GC8R97cO1b_f8ytwtUj8NtrP29FONv1kipCQ/exec";

async function api(action,payload={}){

 const res=await fetch(API,{
  method:"POST",
  headers:{"Content-Type":"text/plain;charset=utf-8"},
  body:JSON.stringify({action,payload})
 });

 return res.json();
}

async function pullReferenceData(){

 const data=await api("getReference");

 await DB.setAll("airports",data.airports);
 await DB.setAll("cities",data.cities);
 await DB.setAll("hotels",data.hotels);
}

async function push(){

 const briefs=await DB.get("briefs");

 for(const b of briefs.filter(x=>!x.synced)){

  const r=await api("saveBrief",b);
  if(r.success) b.synced=true;
 }

 await DB.setAll("briefs",briefs);
}

return {push,pullReferenceData};

})();
