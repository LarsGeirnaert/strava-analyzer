// app.js - Map Visualisatie, GPX Parsing & Upload Logic

let map, polyline, elevationChart;
let segmentLayer = null; // NIEUW: Laag voor de groene highlight
let currentRideData = null; 
let calculatedSegments = []; 

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    
    // Listeners
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
    
    // Klik op kaart verwijdert highlight
    map.on('click', () => {
        if(segmentLayer) {
            map.removeLayer(segmentLayer);
            segmentLayer = null;
        }
    });
}

// 1. RIT OPENEN UIT LIJST
window.openRide = async function(activity) {
    try {
        console.log("Rit openen:", activity.fileName);
        if(window.switchTab) window.switchTab('analysis');

        // Haal bestand op (Lazy Load)
        const fileBlob = await window.supabaseAuth.getActivityFile(activity.id);
        const text = await fileBlob.text();
        
        processGPXAndRender(text, activity.fileName, true);
        
        const saveSection = document.getElementById('save-section');
        if(saveSection) saveSection.classList.add('hidden');

    } catch (e) {
        console.error(e);
        alert("Kon rit data niet ophalen.");
    }
};

// 2. FILE UPLOAD HANDLER
async function handleFileUpload(e, isBulk) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if(window.switchTab) window.switchTab('analysis');

    if (files.length === 1) {
        // Enkele file: Direct renderen
        const file = files[0];
        const text = await file.text();
        processGPXAndRender(text, file.name);
    } else {
        // Bulk: Achtergrond verwerking
        await processBulkUpload(files);
    }
}

// 3. BULK UPLOAD VERWERKING
async function processBulkUpload(files) {
    const statusDiv = document.getElementById('bulk-status');
    statusDiv.style.display = 'block';
    
    let successCount = 0;
    const validFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.gpx') || f.name.toLowerCase().endsWith('.tcx'));

    if(validFiles.length === 0) { statusDiv.innerHTML = "Geen GPX/TCX bestanden."; return; }

    for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        try {
            statusDiv.innerHTML = `⏳ Verwerken: ${i+1}/${validFiles.length} (${file.name})`;
            const text = await file.text();
            
            // Parse
            const rideData = parseGPXData(text, file.name);
            
            if (rideData) {
                // Opslaan Rit
                const blob = new Blob([rideData.xmlString], { type: 'application/xml' });
                await window.supabaseAuth.saveActivity({
                    fileBlob: blob, 
                    fileName: rideData.fileName, 
                    summary: rideData.summary
                });

                // AUTO-SCAN GEMEENTES (Als geoJsonLayer beschikbaar is in UI)
                if (window.findMunisInGpx && window.geoJsonLayer) {
                    const muniLayers = window.geoJsonLayer.getLayers();
                    const found = window.findMunisInGpx(text, muniLayers);
                    if(found.length > 0) {
                        await window.supabaseAuth.saveConqueredMunicipalities(found);
                    }
                }

                successCount++;
            }
        } catch (err) { console.error(`Fout bij ${file.name}:`, err); }
    }

    statusDiv.innerHTML = `✅ Klaar! ${successCount} ritten opgeslagen.`;
    if(window.allActivitiesCache) window.allActivitiesCache = null;
    if(window.updateDashboard) window.updateDashboard();
}

// 4. SINGLE RIT RENDEREN & KLAARZETTEN
function processGPXAndRender(xmlString, fileName, isExistingRide = false) {
    const data = parseGPXData(xmlString, fileName, isExistingRide);
    if (!data) return;

    // Render UI
    updateMap(data.uiData.latlngs);
    updateStats(data.summary.distanceKm, data.uiData.durationMs, data.summary.avgSpeed, data.summary.elevationGain);
    updateChart(data.uiData.distances, data.uiData.elevations);
    updateSegmentsUI(data.summary.segments);
    
    // Panelen tonen
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

// 5. CORE PARSER
function parseGPXData(xmlString, fileName, isExistingRide = false) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    
    // Naam zoeken (indien nieuw)
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
        
        // TCX fallback
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
        xmlString: xmlString,
        fileName: displayName,
        summary: {
            distanceKm: totalDist.toFixed(2),
            elevationGain: Math.round(elevationGain),
            avgSpeed: avgSpeed.toFixed(1),
            durationSec: durationMs / 1000,
            rideDate: startTime ? startTime.toISOString() : new Date().toISOString(),
            segments: segments
        },
        uiData: { latlngs, elevations, distances, durationMs }
    };
}

// 6. OPSLAAN FUNCTIE
async function saveToCloud() {
    if (!currentRideData) return;
    
    const btn = document.getElementById('save-cloud-btn');
    btn.innerText = "⏳..."; btn.disabled = true;

    try {
        await window.supabaseAuth.saveActivity({
            fileBlob: new Blob([currentRideData.xmlString], {type: 'application/xml'}),
            fileName: currentRideData.fileName,
            summary: currentRideData.summary
        });
        
        if (window.findMunisInGpx && window.geoJsonLayer) {
            const muniLayers = window.geoJsonLayer.getLayers();
            const found = window.findMunisInGpx(currentRideData.xmlString, muniLayers);
            if(found.length > 0) {
                await window.supabaseAuth.saveConqueredMunicipalities(found);
            }
        }

        btn.innerText = "✅"; btn.style.background = "#28a745";
        
        if(window.updateDashboard) window.updateDashboard();
        if(window.allActivitiesCache) window.allActivitiesCache = null; 

    } catch (e) {
        console.error(e);
        alert(e.message);
        btn.innerText = "Opslaan"; btn.disabled = false;
    }
}

// === HELPER FUNCTIES ===

// AANGEPAST: Berekent nu ook startIdx en endIdx
function calculateFastestSegments(distances, times) {
    const results = [];
    const targets = [];
    for (let k = 5; k <= 100; k += 5) targets.push(k);
    const totalDist = distances[distances.length - 1];

    targets.forEach(targetKm => {
        if (totalDist < targetKm) return;
        let bestTimeMs = Infinity; 
        let bestStartIdx = 0;
        let bestEndIdx = 0;
        let startIdx = 0; 
        let found = false;

        for (let endIdx = 1; endIdx < distances.length; endIdx++) {
            const distDiff = distances[endIdx] - distances[startIdx];
            if (distDiff >= targetKm) {
                // Optimalisatie: Schuif start op zolang afstand >= target
                while (distances[endIdx] - distances[startIdx + 1] >= targetKm) startIdx++;
                
                const timeDiff = times[endIdx] - times[startIdx];
                if (timeDiff < bestTimeMs) { 
                    bestTimeMs = timeDiff; 
                    bestStartIdx = startIdx; // BEWAAR INDEX
                    bestEndIdx = endIdx;     // BEWAAR INDEX
                    found = true; 
                }
            }
        }
        if (found) {
            results.push({ 
                distance: targetKm, 
                timeMs: bestTimeMs, 
                speed: targetKm / (bestTimeMs / 3600000),
                startIdx: bestStartIdx, // GEEF TERUG
                endIdx: bestEndIdx      // GEEF TERUG
            });
        }
    });
    return results.sort((a, b) => a.distance - b.distance);
}

// AANGEPAST: Voegt click event toe
function updateSegmentsUI(segments) {
    const list = document.getElementById('segments-list');
    list.innerHTML = '';
    if(!segments || segments.length === 0) { list.innerHTML = '<small>Geen segmenten.</small>'; return; }
    
    segments.forEach(seg => {
        const div = document.createElement('div');
        div.className = 'segment-card clickable'; // CSS class voor hover effect
        div.innerHTML = `<span><strong>${seg.distance}km</strong></span> <span>${seg.speed.toFixed(1)} km/u</span>`;
        
        // INTERACTIE: Klik om te highlighten
        div.onclick = () => highlightSegment(seg.startIdx, seg.endIdx);
        
        list.appendChild(div);
    });
}

// app.js (vervang de functie highlightSegment)

function highlightSegment(startIdx, endIdx) {
    if (!map || !currentRideData) return;

    // 1. KAART HIGHLIGHT (De groene lijn op de kaart)
    if (segmentLayer) { map.removeLayer(segmentLayer); }
    
    const fullPath = currentRideData.uiData.latlngs;
    const segmentPath = fullPath.slice(startIdx, endIdx + 1);
    
    segmentLayer = L.polyline(segmentPath, {
        color: '#00ff00', // Fel groen
        weight: 6,        // Dikker
        opacity: 1,
        lineCap: 'round'
    }).addTo(map);
    
    map.fitBounds(segmentLayer.getBounds(), { padding: [50, 50] });

    // 2. GRAFIEK HIGHLIGHT (De "Overlay" methode)
    if (elevationChart) {
        const originalDataset = elevationChart.data.datasets[0]; // De oranje lijn
        const totalPoints = originalDataset.data.length;
        const realTotalPoints = currentRideData.uiData.latlngs.length; // Originele GPS punten

        // Omdat de grafiek data "gefilterd" is (step), moeten we de index omrekenen
        const ratio = totalPoints / realTotalPoints;
        const chartStart = Math.floor(startIdx * ratio);
        const chartEnd = Math.ceil(endIdx * ratio);

        // Maak een lege lijst (null) en vul ALLEEN het segment in
        const highlightData = new Array(totalPoints).fill(null);
        
        for (let i = 0; i < totalPoints; i++) {
            if (i >= chartStart && i <= chartEnd) {
                highlightData[i] = originalDataset.data[i];
            }
        }

        // Check of we de highlight laag al hebben, anders maken we hem
        // We willen altijd maximaal 2 datasets: [0]=Oranje basis, [1]=Groene highlight
        if (elevationChart.data.datasets.length > 1) {
            // Update bestaande highlight laag
            elevationChart.data.datasets[1].data = highlightData;
        } else {
            // Maak nieuwe highlight laag aan
            elevationChart.data.datasets.push({
                label: 'Segment',
                data: highlightData,
                borderColor: '#00ff00',       // Fel Groene Lijn
                backgroundColor: 'rgba(0, 255, 0, 0.4)', // Groene Gloed eronder
                borderWidth: 3,               // Iets dikker dan normaal
                pointRadius: 0,               // Geen bolletjes (strakke lijn)
                pointHoverRadius: 5,
                fill: true,                   // Vul het gebied onder de lijn!
                order: 0                      // Ligt BOVENOP oranje
            });
        }

        elevationChart.update();
    }
}

function updateMap(latlngs) {
    if (!map) return;
    if (polyline) map.removeLayer(polyline);
    if (segmentLayer) { map.removeLayer(segmentLayer); segmentLayer = null; } // Reset highlight bij nieuwe rit

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
    const step = Math.ceil(labels.length / 500); // Optimalisatie voor grote ritten
    
    if (elevationChart) elevationChart.destroy();

    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            // We filteren de labels voor betere performance
            labels: labels.filter((_,i) => i % step === 0).map(d => d.toFixed(1)),
            datasets: [
                { 
                    label: 'Hoogte', 
                    // Originele data (Oranje)
                    data: dataPoints.filter((_,i) => i % step === 0), 
                    borderColor: '#fc4c02', 
                    backgroundColor: 'rgba(252,76,2,0.1)', 
                    fill: true, 
                    pointRadius: 0,
                    borderWidth: 2,
                    order: 1 // Ligt onderop
                }
            ]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, 
            scales: { x: { display: false }, y: { display: true } },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; const p = Math.PI/180;
    const a = 0.5 - Math.cos((lat2-lat1)*p)/2 + Math.cos(lat1*p)*Math.cos(lat2*p) * (1-Math.cos((lon2-lon1)*p))/2;
    return 12742 * Math.asin(Math.sqrt(a));
}