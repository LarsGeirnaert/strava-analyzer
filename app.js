// app.js - Map Visualisatie, GPX Parsing & Upload Logic

let map, polyline, elevationChart;
let segmentLayer = null; 
let currentRideData = null; 
let calculatedSegments = []; 
let activeSegment = null; 
let hoverMarker = null; // Het bolletje op de kaart

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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    map.on('click', () => clearSegmentHighlight());
}

window.openRide = async function(activity) {
    try {
        if(window.switchTab) window.switchTab('analysis');
        const fileBlob = await window.supabaseAuth.getActivityFile(activity.id);
        const text = await fileBlob.text();
        processGPXAndRender(text, activity.fileName, true);
        const saveSection = document.getElementById('save-section');
        if(saveSection) saveSection.classList.add('hidden');
    } catch (e) { console.error(e); alert("Kon rit data niet ophalen."); }
};

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

    if(validFiles.length === 0) { statusDiv.innerHTML = "Geen GPX/TCX bestanden."; return; }

    for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        try {
            statusDiv.innerHTML = `⏳ Verwerken: ${i+1}/${validFiles.length} (${file.name})`;
            const text = await file.text();
            const rideData = parseGPXData(text, file.name);
            if (rideData) {
                const blob = new Blob([rideData.xmlString], { type: 'application/xml' });
                await window.supabaseAuth.saveActivity({ fileBlob: blob, fileName: rideData.fileName, summary: rideData.summary });
                if (window.findMunisInGpx && window.geoJsonLayer) {
                    const muniLayers = window.geoJsonLayer.getLayers();
                    const found = window.findMunisInGpx(text, muniLayers);
                    if(found.length > 0) await window.supabaseAuth.saveConqueredMunicipalities(found);
                }
                successCount++;
            }
        } catch (err) { console.error(`Fout bij ${file.name}:`, err); }
    }
    statusDiv.innerHTML = `✅ Klaar! ${successCount} ritten opgeslagen.`;
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
    if(btn) { btn.innerText = `💾 Opslaan als "${data.fileName}"`; btn.disabled = false; btn.style.background = ""; }
    currentRideData = data;
}

// --- CORE PARSER (AANGEPAST VOOR SNELHEID) ---
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

    const latlngs = [], elevations = [], distances = [], times = [], speeds = []; // NIEUW: Speeds array
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
            
            // NIEUW: Snelheidsberekening per punt
            let currentSpeed = 0;

            if(i===0) {
                startTime = t; 
                speeds.push(0);
            } else {
                const prevLat = latlngs[i-1][0];
                const prevLon = latlngs[i-1][1];
                const distDiff = getDistanceFromLatLonInKm(prevLat, prevLon, lat, lon);
                
                totalDist += distDiff;
                
                // Hoogte
                const prevEle = elevations[i-1];
                if (ele > prevEle) elevationGain += (ele - prevEle);

                // Snelheid: km / uur
                const timeDiffHours = (t - times[i-1]) / 3600000; // ms naar uren
                
                if (timeDiffHours > 0 && distDiff > 0) {
                    currentSpeed = distDiff / timeDiffHours;
                    // Filter GPS fouten (bijv. > 120 km/u op de fiets is onwaarschijnlijk)
                    if(currentSpeed > 120) currentSpeed = speeds[i-1] || 0; 
                } else {
                    currentSpeed = 0; // Stilstand
                }
                speeds.push(currentSpeed);
            }
            endTime = t;
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
        // Voeg speeds toe aan uiData voor de grafieken
        uiData: { latlngs, elevations, distances, speeds, durationMs } 
    };
}

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
            if(found.length > 0) await window.supabaseAuth.saveConqueredMunicipalities(found);
        }
        btn.innerText = "✅"; btn.style.background = "#28a745";
        if(window.updateDashboard) window.updateDashboard();
        if(window.allActivitiesCache) window.allActivitiesCache = null; 
    } catch (e) { console.error(e); alert(e.message); btn.innerText = "Opslaan"; btn.disabled = false; }
}

function calculateFastestSegments(distances, times) {
    const results = [];
    const targets = [];
    for (let k = 5; k <= 100; k += 5) targets.push(k);
    const totalDist = distances[distances.length - 1];

    targets.forEach(targetKm => {
        if (totalDist < targetKm) return;
        let bestTimeMs = Infinity; let bestStartIdx = 0; let bestEndIdx = 0; let startIdx = 0; let found = false;
        for (let endIdx = 1; endIdx < distances.length; endIdx++) {
            const distDiff = distances[endIdx] - distances[startIdx];
            if (distDiff >= targetKm) {
                while (distances[endIdx] - distances[startIdx + 1] >= targetKm) startIdx++;
                const timeDiff = times[endIdx] - times[startIdx];
                if (timeDiff < bestTimeMs) { bestTimeMs = timeDiff; bestStartIdx = startIdx; bestEndIdx = endIdx; found = true; }
            }
        }
        if (found) results.push({ distance: targetKm, timeMs: bestTimeMs, speed: targetKm / (bestTimeMs / 3600000), startIdx: bestStartIdx, endIdx: bestEndIdx });
    });
    return results.sort((a, b) => a.distance - b.distance);
}

function updateSegmentsUI(segments) {
    const list = document.getElementById('segments-list');
    list.innerHTML = '';
    activeSegment = null;
    if(!segments || segments.length === 0) { list.innerHTML = '<small>Geen segmenten.</small>'; return; }
    
    const clearBtn = document.createElement('div');
    clearBtn.id = 'clear-segment-btn';
    clearBtn.className = 'segment-card clickable hidden';
    clearBtn.style.textAlign = 'center'; clearBtn.style.justifyContent = 'center'; clearBtn.style.background = 'var(--hover-bg)';
    clearBtn.innerHTML = '<span>❌ Wis Selectie</span>';
    clearBtn.onclick = () => clearSegmentHighlight();
    list.appendChild(clearBtn);

    segments.forEach(seg => {
        const div = document.createElement('div');
        div.className = 'segment-card clickable';
        div.dataset.dist = seg.distance;
        div.innerHTML = `<span><strong>${seg.distance}km</strong></span> <span>${seg.speed.toFixed(1)} km/u</span>`;
        div.onclick = () => { if (activeSegment === seg.distance) clearSegmentHighlight(); else highlightSegment(seg.startIdx, seg.endIdx, seg.distance); };
        list.appendChild(div);
    });
}

function clearSegmentHighlight() {
    activeSegment = null;
    if (segmentLayer) { map.removeLayer(segmentLayer); segmentLayer = null; }
    map.fitBounds(polyline.getBounds());
    if(elevationChart && elevationChart.data.datasets.length > 1) { elevationChart.data.datasets.pop(); elevationChart.update(); }
    document.querySelectorAll('.segment-card').forEach(c => c.classList.remove('active-segment'));
    const btn = document.getElementById('clear-segment-btn');
    if(btn) btn.classList.add('hidden');
}

function highlightSegment(startIdx, endIdx, dist) {
    if (!map || !currentRideData) return;
    activeSegment = dist;
    document.querySelectorAll('.segment-card').forEach(c => c.classList.remove('active-segment'));
    const activeCard = document.querySelector(`.segment-card[data-dist="${dist}"]`);
    if(activeCard) activeCard.classList.add('active-segment');
    const btn = document.getElementById('clear-segment-btn');
    if(btn) btn.classList.remove('hidden');

    if (segmentLayer) { map.removeLayer(segmentLayer); }
    const fullPath = currentRideData.uiData.latlngs;
    const segmentPath = fullPath.slice(startIdx, endIdx + 1);
    segmentLayer = L.polyline(segmentPath, { color: '#00ff00', weight: 6, opacity: 1, lineCap: 'round' }).addTo(map);
    map.fitBounds(segmentLayer.getBounds(), { padding: [50, 50] });

    if (elevationChart) {
        const originalDataset = elevationChart.data.datasets[0];
        const totalPoints = originalDataset.data.length;
        const realTotalPoints = currentRideData.uiData.latlngs.length;
        const ratio = totalPoints / realTotalPoints;
        const chartStart = Math.floor(startIdx * ratio);
        const chartEnd = Math.ceil(endIdx * ratio);
        const highlightData = new Array(totalPoints).fill(null);
        for (let i = 0; i < totalPoints; i++) { if (i >= chartStart && i <= chartEnd) { highlightData[i] = originalDataset.data[i]; } }
        if (elevationChart.data.datasets.length > 1) { elevationChart.data.datasets[1].data = highlightData; } 
        else { elevationChart.data.datasets.push({ label: 'Segment', data: highlightData, borderColor: '#00ff00', backgroundColor: 'rgba(0, 255, 0, 0.4)', borderWidth: 3, pointRadius: 0, pointHoverRadius: 5, fill: true, order: 0 }); }
        elevationChart.update();
    }
}

function updateMap(latlngs) {
    if (!map) return;
    if (polyline) map.removeLayer(polyline);
    if (segmentLayer) { map.removeLayer(segmentLayer); segmentLayer = null; } 
    polyline = L.polyline(latlngs, {color: '#fc4c02', weight: 4}).addTo(map);
    setTimeout(() => { map.invalidateSize(); map.fitBounds(polyline.getBounds()); }, 200);
}

function updateStats(dist, timeMs, speed, ele) {
    const d = document.getElementById('statDist');
    const t = document.getElementById('statTime');
    const s = document.getElementById('statSpeed');
    const e = document.getElementById('statElev');

    if(d) d.innerText = typeof dist === 'string' ? dist : dist.toFixed(2);
    if(e) e.innerText = Math.round(ele);
    if(s) s.innerText = typeof speed === 'string' ? speed : speed.toFixed(1);
    
    if(t) {
        const h = Math.floor(timeMs / 3600000); 
        const m = Math.floor((timeMs % 3600000) / 60000);
        t.innerText = `${h}:${m.toString().padStart(2,'0')}`;
    }
}

function updateChart(labels, dataPoints) {
    const ctx = document.getElementById('elevationChart').getContext('2d');
    const step = Math.ceil(labels.length / 500); 
    
    // Gefilterde data voor de grafiek weergave
    const filteredLabels = labels.filter((_, i) => i % step === 0);
    const filteredData = dataPoints.filter((_, i) => i % step === 0);

    if (elevationChart) elevationChart.destroy();
    
    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: filteredLabels.map(d => d.toFixed(1)),
            datasets: [{ 
                label: 'Hoogte', 
                data: filteredData, 
                borderColor: '#fc4c02', 
                backgroundColor: 'rgba(252,76,2,0.1)', 
                fill: true, 
                pointRadius: 0, 
                borderWidth: 2 
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onHover: (event, chartElements) => {
                // Als we over de grafiek hoveren
                if (chartElements.length > 0) {
                    const index = chartElements[0].index;
                    // Bereken de werkelijke index in de volledige latlngs array
                    const realIndex = index * step;
                    showPointOnMap(realIndex);
                } else {
                    hidePointOnMap();
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: { x: { display: false }, y: { display: true } },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

// Functie om het punt op de kaart te tonen
function showPointOnMap(index) {
    if (!currentRideData || !map) return;
    const latlng = currentRideData.uiData.latlngs[index];
    if (!latlng) return;

    if (!hoverMarker) {
        hoverMarker = L.circleMarker(latlng, {
            radius: 8,
            fillColor: "#007bff", // Blauw bolletje
            color: "#fff",
            weight: 3,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map);
    } else {
        hoverMarker.setLatLng(latlng);
    }
}

function hidePointOnMap() {
    if (hoverMarker && map) {
        map.removeLayer(hoverMarker);
        hoverMarker = null;
    }
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; const p = Math.PI/180;
    const a = 0.5 - Math.cos((lat2-lat1)*p)/2 + Math.cos(lat1*p)*Math.cos(lat2*p) * (1-Math.cos((lon2-lon1)*p))/2;
    return 12742 * Math.asin(Math.sqrt(a));
}

// EXPORTS
window.parseGPXData = parseGPXData;
window.switchTab = switchTab;
window.updateDashboard = updateDashboard;