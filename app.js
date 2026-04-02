document.addEventListener("DOMContentLoaded", init);

function init() {

  document
    .getElementById("newBrief")
    .addEventListener("click", createBrief);

  document
    .getElementById("syncBtn")
    .addEventListener("click", syncNow);

  render();
}

async function createBrief() {

  const brief = {
    id: Date.now(),
    flightNumber: "ET" + Math.floor(Math.random()*900+100),
    created: new Date().toISOString(),
    synced:false
  };

  await DB.saveBrief(brief);
  render();
}

async function render() {

  const briefs = await DB.getBriefs();

  const out = document.getElementById("output");

  out.innerHTML = briefs.map(b => `
    <div style="padding:10px;border-bottom:1px solid #334155">
      ${b.flightNumber}
      ${b.synced ? "✅" : "🕓"}
    </div>
  `).join("");
}

async function syncNow(){
  await Sync.push();
  render();
}
