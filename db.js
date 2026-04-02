
const DB = (()=>{

let db;

async function init(){

 return new Promise(res=>{

  const req=indexedDB.open("crewbriefs",2);

  req.onupgradeneeded=e=>{
    db=e.target.result;

    ["briefs","airports","cities","hotels"]
      .forEach(t=>{
        if(!db.objectStoreNames.contains(t))
          db.createObjectStore(t,{keyPath:"id",autoIncrement:true});
      });
  };

  req.onsuccess=e=>{
    db=e.target.result;
    res();
  };

 });
}

function tx(store,mode){
 return db.transaction(store,mode).objectStore(store);
}

async function add(store,data){
 return new Promise(r=>{
  tx(store,"readwrite").add(data).onsuccess=r;
 });
}

async function setAll(store,rows){
 return new Promise(r=>{
  const t=tx(store,"readwrite");
  t.clear();
  rows.forEach(x=>t.add(x));
  t.transaction.oncomplete=r;
 });
}

async function get(store){
 return new Promise(r=>{
  const req=tx(store,"readonly").getAll();
  req.onsuccess=()=>r(req.result);
 });
}

return {init,add,get,setAll};

})();
