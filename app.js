document.addEventListener("DOMContentLoaded", init);

async function init(){
  await DB.init();
  await Sync.pullReferenceData();
  populateSelectors();

  document.getElementById("hotel")
    .addEventListener("change", autofillAmenities);

  document.getElementById("saveBtn")
    .addEventListener("click", saveBrief);

  document.getElementById("syncBtn")
    .addEventListener("click", Sync.push);

  render();
}

async function populateSelectors(){

  const airports = await DB.get("airports");
  const hotels = await DB.get("hotels");

  origin.innerHTML =
    airports.map(a=>`<option>${a.ICAO}</option>`).join("");

  destination.innerHTML = origin.innerHTML;

  hotel.innerHTML =
    hotels.map(h=>`<option>${h.HotelName}</option>`).join("");
}

async function autofillAmenities(){

  const hotels = await DB.get("hotels");
  const h = hotels.find(x=>x.HotelName===hotel.value);

  amenities.innerText = h?.Amenities || "";
}

async function saveBrief(){

  const brief={
    id:Date.now(),
    flight:flight.value,
    origin:origin.value,
    destination:destination.value,
    hotel:hotel.value,
    amenities:amenities.innerText,
    synced:false
  };

  await DB.add("briefs",brief);
  render();
}

async function render(){

  const briefs = await DB.get("briefs");

  list.innerHTML = briefs.map(b=>`
    <div>
      ${b.flight} ${b.origin}-${b.destination}
      ${b.synced?"✅":"🕓"}
    </div>
  `).join("");
}
