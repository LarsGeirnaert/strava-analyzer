// app.js - Aangepast voor Lazy Loading

let map, polyline, elevationChart;
let currentRideData = null; 
let calculatedSegments = []; 

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    const gpxInput = document.getElementById('gpxInput');
    if(gpxInput) gpxInput.addEventListener('change', (e) => handleFileUpload(e, false));
    const folderInput = document.getElementById('folderInput');
    if(folderInput) folderInput.addEventListener('change', (e) => handleFileUpload(e, true));
    const saveBtn = document.getElementById('save-cloud-btn');
    if(saveBtn) saveBtn.addEventListener('click', saveToCloud);
});

function initMap() {
    const mapContainer = document.getElementById('map');
    if(!mapContainer) return;
    map = L.map('map').setView([52.09, 5.12], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map);
}

// FIX: Deze functie haalt nu eerst de data op voordat hij renderet
window.openRide = async function(activity) {
    try {
        console.log("Rit openen:", activity.file_name);
        
        if(window.switchTab) window.switchTab('analysis');

        // Toon laad-indicator (optioneel, of alert)
        // document.body.style.cursor = 'wait';

        // 1. Haal de file content op (dit ontbreekt nu in de lijst)
        const fileBlob = await window.supabaseAuth.getActivityFile(activity.id);
        const text = await fileBlob.text();
        
        // 2. Verwerk en teken
        processGPXAndRender(text, activity.file_name, true);
        
        const saveSection = document.getElementById('save-section');
        if(saveSection) saveSection.classList.add('hidden');

    } catch (e) {
        console.error(e);
        alert("Kon rit data niet ophalen uit database.");
    } finally {
        // document.body.style.cursor = 'default';
    }
};

// ... (De rest van app.js blijft grotendeels hetzelfde, hieronder de helpers voor de volledigheid) ...

async function handleFileUpload(e, isBulk) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if(window.switchTab) window.switchTab('analysis');

    if (files.length === 1) {
        const file = files[0];
        const text = await file.text();
        processGPXAndRender(text, file.name);
    } else {
        await processBulkUpload(files);
    }
}

async function processBulkUpload(files) {
    const statusDiv = document.getElementById('bulk-status');
    statusDiv.style.display = 'block';
    let successCount = 0;
    
    const validFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.gpx') || f.name.toLowerCase().endsWith('.tcx'));
    if(validFiles.length === 0) { statusDiv.innerHTML = "Geen bestanden."; return; }

    for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        try {
            statusDiv.innerHTML = `⏳ ${i+1}/${validFiles.length}: ${file.name}`;
            const text = await file.text();
            const rideData = parseGPXData(text, file.name);
            if (rideData) {
                const blob = new Blob([rideData.xmlString], { type: 'application/xml' });
                await window.supabaseAuth.saveActivity({
                    fileBlob: blob, fileName: rideData.fileName, summary: rideData.summary
                });
                successCount++;
            }
        } catch (err) { console.error(err); }
    }
    statusDiv.innerHTML = `✅ ${successCount} ritten opgeslagen!`;
    if(window.allActivitiesCache) window.allActivitiesCache = null;
    if(window.updateDashboard) window.updateDashboard();
}

function processGPXAndRender(xmlString, fileName, isExistingRide = false) {
    const data = parseGPXData(xmlString, fileName, isExistingRide);
    if (!data) return;

    updateMap(data.uiData.latlngs);
    updateStats(data.summary.distanceKm, data.uiData.durationMs, data.summary.avgSpeed, data.summary.elevationGain);
    updateChart(data.uiData.distances, data.uiData.elevations);
    updateSegmentsUI(data.summary.segments);
    
    document.getElementById('statsPanel').classList.remove('hidden');
    document.getElementById('chartsPanel').classList.remove('hidden');
    document.getElementById('current-segments-section').classList.remove('hidden');
    
    const saveSection = document.getElementById('save-section');
    if(saveSection) saveSection.classList.remove('hidden');
    
    const btn = document.getElementById('save-cloud-btn');
    if(btn) {
        btn.innerText = `💾 Opslaan als "${data.fileName}"`; 
        btn.disabled = false; btn.style.background = "";
    }
    currentRideData = data;
}

function parseGPXData(xmlString, fileName, isExistingRide = false) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    
    let displayName = fileName;
    if (!isExistingRide) {
        const nameTags = xmlDoc.getElementsByTagName('name');
        if (nameTags.length > 0) {
            const potentialName = nameTags[0].textContent.trim();
            if (potentialName && potentialName !== "Strava GPX") displayName = potentialName;
        }
    }

    let trkpts = xmlDoc.getElementsByTagName('trkpt');
    if (!trkpts.length) trkpts = xmlDoc.getElementsByTagName('Trackpoint');
    if (!trkpts.length) return null;

    const latlngs = [], elevations = [], distances = [], times = [];
    let totalDist = 0, elevationGain = 0;
    let startTime = null, endTime = null;

    for (let i = 0; i < trkpts.length; i++) {
        let lat = parseFloat(trkpts[i].getAttribute('lat'));
        let lon = parseFloat(trkpts[i].getAttribute('lon'));
        if (isNaN(lat)) lat = parseFloat(trkpts[i].getElementsByTagName('LatitudeDegrees')[0]?.textContent);
        if (isNaN(lon)) lon = parseFloat(trkpts[i].getElementsByTagName('LongitudeDegrees')[0]?.textContent);
        let ele = parseFloat(trkpts[i].getElementsByTagName('ele')[0]?.textContent);
        if (isNaN(ele)) ele = parseFloat(trkpts[i].getElementsByTagName('AltitudeMeters')[0]?.textContent || 0);
        let timeStr = trkpts[i].getElementsByTagName('time')[0]?.textContent || trkpts[i].getElementsByTagName('Time')[0]?.textContent;
        
        if (!isNaN(lat) && !isNaN(lon)) {
            const t = new Date(timeStr);
            latlngs.push([lat, lon]); elevations.push(ele); times.push(t);
            if(i===0) startTime = t; endTime = t;
            if (i > 0 && latlngs.length > 1) {
                const prev = latlngs[latlngs.length - 2];
                totalDist += getDistanceFromLatLonInKm(prev[0], prev[1], lat, lon);
                const prevEle = elevations[elevations.length - 2];
                if (ele > prevEle) elevationGain += (ele - prevEle);
            }
            distances.push(totalDist);
        }
    }
    const durationMs = (endTime - startTime);
    const avgSpeed = durationMs > 0 ? totalDist / (durationMs / 3600000) : 0;
    const segments = calculateFastestSegments(distances, times);

    return {
        xmlString, fileName: displayName,
        summary: { distanceKm: totalDist.toFixed(2), elevationGain: Math.round(elevationGain), avgSpeed: avgSpeed.toFixed(1), durationSec: durationMs / 1000, rideDate: startTime ? startTime.toISOString() : new Date().toISOString(), segments },
        uiData: { latlngs, elevations, distances, durationMs }
    };
}

function calculateFastestSegments(distances, times) {
    const results = [];
    const targets = [];
    for (let k = 5; k <= 100; k += 5) targets.push(k);
    const totalDist = distances[distances.length - 1];
    targets.forEach(targetKm => {
        if (totalDist < targetKm) return;
        let bestTimeMs = Infinity; let startIdx = 0; let found = false;
        for (let endIdx = 1; endIdx < distances.length; endIdx++) {
            const distDiff = distances[endIdx] - distances[startIdx];
            if (distDiff >= targetKm) {
                while (distances[endIdx] - distances[startIdx + 1] >= targetKm) startIdx++;
                const timeDiff = times[endIdx] - times[startIdx];
                if (timeDiff < bestTimeMs) { bestTimeMs = timeDiff; found = true; }
            }
        }
        if (found) results.push({ distance: targetKm, timeMs: bestTimeMs, speed: targetKm / (bestTimeMs / 3600000) });
    });
    return results.sort((a, b) => a.distance - b.distance);
}
function updateSegmentsUI(segments) {
    const list = document.getElementById('segments-list'); list.innerHTML = '';
    if(!segments || segments.length === 0) { list.innerHTML = '<small>Geen segmenten.</small>'; return; }
    segments.forEach(seg => {
        const div = document.createElement('div'); div.className = 'segment-card';
        div.innerHTML = `<span><strong>${seg.distance}km</strong></span> <span>${seg.speed.toFixed(1)} km/u</span>`;
        list.appendChild(div);
    });
}
function updateMap(latlngs) {
    if (!map) return;
    if (polyline) map.removeLayer(polyline);
    polyline = L.polyline(latlngs, {color: '#fc4c02', weight: 4}).addTo(map);
    setTimeout(() => { map.invalidateSize(); map.fitBounds(polyline.getBounds()); }, 200);
}
function updateStats(dist, timeMs, speed, ele) {
    document.getElementById('statDist').innerText = typeof dist === 'string' ? dist : dist.toFixed(2);
    document.getElementById('statElev').innerText = Math.round(ele);
    document.getElementById('statSpeed').innerText = typeof speed === 'string' ? speed : speed.toFixed(1);
    const h = Math.floor(timeMs / 3600000);
    const m = Math.floor((timeMs % 3600000) / 60000);
    document.getElementById('statTime').innerText = `${h}:${m.toString().padStart(2,'0')}`;
}
function updateChart(labels, dataPoints) {
    const ctx = document.getElementById('elevationChart').getContext('2d');
    const step = Math.ceil(labels.length / 500);
    if (elevationChart) elevationChart.destroy();
    elevationChart = new Chart(ctx, {
        type: 'line', data: { labels: labels.filter((_,i)=>i%step===0).map(d=>d.toFixed(1)), datasets: [{ label: 'Hoogte', data: dataPoints.filter((_,i)=>i%step===0), borderColor: '#fc4c02', backgroundColor: 'rgba(252,76,2,0.1)', fill: true, pointRadius: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: {display:false} }, scales: { x: {display:false} } }
    });
}
async function saveToCloud() {
    if (!currentRideData) return;
    const btn = document.getElementById('save-cloud-btn');
    btn.innerText = "⏳..."; btn.disabled = true;
    try {
        await window.supabaseAuth.saveActivity({
            fileBlob: new Blob([currentRideData.xmlString], {type: 'application/xml'}),
            fileName: currentRideData.fileName, summary: currentRideData.summary
        });
        btn.innerText = "✅"; btn.style.background = "#28a745";
        if(window.updateDashboard) window.updateDashboard();
        if(window.allActivitiesCache) window.allActivitiesCache = null; 
    } catch (e) { alert(e.message); btn.innerText = "Opslaan"; btn.disabled = false; }
}
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; const p = Math.PI/180;
    const a = 0.5 - Math.cos((lat2-lat1)*p)/2 + Math.cos(lat1*p)*Math.cos(lat2*p) * (1-Math.cos((lon2-lon1)*p))/2;
    return 12742 * Math.asin(Math.sqrt(a));
}