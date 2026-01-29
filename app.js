// app.js - Map Visualisatie, GPX Parsing & Upload Logic

let map, polyline, elevationChart;
let segmentLayer = null; 
let currentRideData = null; 
let activeSegment = null; 
let hoverMarker = null; 

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    
    const gpxInput = document.getElementById('gpxInput');
    if(gpxInput) gpxInput.addEventListener('change', (e) => handleFileUpload(e));
    
    const folderInput = document.getElementById('folderInput');
    if(folderInput) folderInput.addEventListener('change', (e) => handleFolderUpload(e));

    const saveBtn = document.getElementById('save-cloud-btn');
    if(saveBtn) saveBtn.addEventListener('click', saveToCloud);
});

function initMap() {
    const mapContainer = document.getElementById('map');
    if(!mapContainer) return;
    map = L.map('map').setView([50.85, 4.35], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    map.on('click', () => { if (typeof clearSegmentHighlight === 'function') clearSegmentHighlight(); });
}

function clearSegmentHighlight() {
    activeSegment = null;
    if (segmentLayer && map) { map.removeLayer(segmentLayer); segmentLayer = null; }
    if (polyline && map.hasLayer(polyline)) { try { map.fitBounds(polyline.getBounds()); } catch(e) {} }
    if(elevationChart && elevationChart.data.datasets.length > 2) { 
        elevationChart.data.datasets.pop(); 
        elevationChart.update(); 
    }
    document.querySelectorAll('.segment-card').forEach(c => c.classList.remove('active-segment'));
    const btn = document.getElementById('clear-segment-btn');
    if(btn) btn.classList.add('hidden');
}

window.openRide = async function(activity) {
    try {
        if(window.switchTab) window.switchTab('analysis');
        const fileBlob = await window.supabaseAuth.getActivityFile(activity.id);
        const text = await fileBlob.text();
        processGPXAndRender(text, activity.fileName, true, activity.summary);
        const saveSection = document.getElementById('save-section');
        if(saveSection) saveSection.classList.add('hidden');
    } catch (e) { console.error(e); alert("Kon rit data niet ophalen."); }
};

async function handleFileUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if(window.switchTab) window.switchTab('analysis');
    const file = files[0];
    const text = await file.text();
    processGPXAndRender(text, file.name);
}

// --- FOLDER UPLOAD ---
async function handleFolderUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const progressEl = document.getElementById('upload-progress');
    if(progressEl) progressEl.style.display = 'block';
    
    const CUTOFF_DATE = new Date('2024-01-01T00:00:00').getTime();
    let processed = 0; let uploaded = 0; let skipped = 0;

    if(window.switchTab) window.switchTab('analysis');
    console.log(`Start verwerken van ${files.length} bestanden...`);

    for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.gpx')) continue;
        try {
            if(progressEl) progressEl.innerText = `Checken: ${file.name} (${processed}/${files.length})`;
            const text = await file.text();
            const timeMatch = text.match(/<time>(.*?)<\/time>/);
            
            if (timeMatch && timeMatch[1]) {
                const rideDate = new Date(timeMatch[1]).getTime();
                if (rideDate > CUTOFF_DATE) {
                    const data = parseGPXData(text, file.name); 
                    if (data) {
                        await window.supabaseAuth.saveActivity({
                            fileBlob: new Blob([text], {type: 'application/xml'}),
                            fileName: data.fileName,
                            summary: data.summary
                        });
                        console.log(`✅ Geüpload: ${file.name}`);
                        uploaded++;
                    }
                } else {
                    console.log(`⏭️ Overgeslagen (Te oud): ${file.name}`);
                    skipped++;
                }
            }
        } catch (err) { console.error(`Fout bij ${file.name}:`, err); }
        processed++;
    }

    if(progressEl) progressEl.innerText = `Klaar! ${uploaded} geüpload, ${skipped} overgeslagen.`;
    alert(`Batch klaar!\n✅ ${uploaded} nieuwe ritten toegevoegd.\n⏭️ ${skipped} ritten van voor 2024 genegeerd.`);
    if(window.updateDashboard) window.updateDashboard();
    document.getElementById('folderInput').value = '';
}

function processGPXAndRender(xmlString, fileName, isExistingRide = false, existingSummary = null) {
    const data = parseGPXData(xmlString, fileName, isExistingRide);
    if (!data) return;
    currentRideData = data;
    updateMap(data.uiData.latlngs);
    
    const avgPower = data.uiData.powers.length > 0 
        ? Math.round(data.uiData.powers.reduce((a,b)=>a+b,0) / data.uiData.powers.length) 
        : 0;

    const displayMaxSpeed = (existingSummary && existingSummary.maxSpeed) 
        ? existingSummary.maxSpeed 
        : data.summary.maxSpeed;

    updateStats(
        data.summary.distanceKm, 
        data.uiData.durationMs, 
        data.summary.avgSpeed, 
        data.summary.elevationGain, 
        avgPower,
        displayMaxSpeed 
    );

    updateChart(data.uiData.distances, data.uiData.elevations, data.uiData.speeds, data.uiData.powers);
    
    if(typeof updateSegmentsUI === 'function') updateSegmentsUI(data.summary.segments);
    
    document.getElementById('statsPanel')?.classList.remove('hidden');
    document.getElementById('chartsPanel')?.classList.remove('hidden');
    document.getElementById('current-segments-section')?.classList.remove('hidden');
    const saveSection = document.getElementById('save-section');
    if(saveSection && !isExistingRide) saveSection.classList.remove('hidden');
}

function updateStats(dist, timeMs, speed, ele, power, maxSpeed) {
    const d = document.getElementById('statDist');
    const t = document.getElementById('statTime');
    const s = document.getElementById('statSpeed');
    const e = document.getElementById('statElev');
    const p = document.getElementById('statPower');
    const ms = document.getElementById('statMaxSpeed'); 

    if(d) d.innerText = typeof dist === 'string' ? dist : parseFloat(dist).toFixed(2);
    if(e) e.innerText = Math.round(ele);
    if(s) s.innerText = typeof speed === 'string' ? speed : parseFloat(speed).toFixed(1);
    if(ms) ms.innerText = maxSpeed ? parseFloat(maxSpeed).toFixed(1) : "0.0";
    if(t) { const h = Math.floor(timeMs / 3600000); const m = Math.floor((timeMs % 3600000) / 60000); t.innerText = `${h}:${m.toString().padStart(2,'0')}`; }
    if(p) p.innerText = power || 0;
}

// --- FILTER LOGICA ---
function removeSpikes(data) {
    const clean = [...data];
    const threshold = 15;
    for (let i = 1; i < clean.length - 1; i++) {
        const prev = clean[i-1];
        const curr = clean[i];
        const next = clean[i+1];
        if (curr > 20 && curr > prev + threshold && curr > next + threshold) {
            clean[i] = (prev + next) / 2;
        }
    }
    return clean;
}

function applyMedianFilter(data, windowSize) {
    const result = [];
    const half = Math.floor(windowSize / 2);
    for(let i = 0; i < data.length; i++) {
        let start = Math.max(0, i - half);
        let end = Math.min(data.length, i + half + 1);
        const slice = data.slice(start, end).filter(v => !isNaN(v));
        if (slice.length === 0) { result.push(0); continue; }
        slice.sort((a, b) => a - b);
        const mid = Math.floor(slice.length / 2);
        result.push(slice[mid]);
    }
    return result;
}

function smoothArray(data, windowSize) {
    return data.map((val, idx, arr) => {
        if (val === undefined || val === null || isNaN(val)) return 0;
        let start = Math.max(0, idx - windowSize);
        let end = Math.min(arr.length, idx + windowSize + 1);
        let sum = 0, count = 0;
        for(let k = start; k < end; k++) { 
            if(!isNaN(arr[k])) { sum += arr[k]; count++; }
        }
        return count > 0 ? sum / count : 0;
    });
}

function parseGPXData(xmlString, fileName, isExistingRide = false) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    
    let displayName = fileName;
    if (!isExistingRide) {
        const nameTags = xmlDoc.getElementsByTagName('name');
        if (nameTags.length > 0) displayName = nameTags[0].textContent.trim();
    }

    let trkpts = xmlDoc.getElementsByTagName('trkpt');
    if (trkpts.length === 0) trkpts = xmlDoc.getElementsByTagName('Trackpoint');
    if (trkpts.length === 0) trkpts = xmlDoc.getElementsByTagName('rtept');
    if (trkpts.length === 0) return null;

    const latlngs = [], elevations = [], distances = [], times = [];
    let rawSpeeds = [], rawPowers = [];
    let totalDist = 0, elevationGain = 0;
    let startTime = null, endTime = null;

    const riderWeight = 75; const bikeWeight = 9; const totalWeight = riderWeight + bikeWeight;

    for (let i = 0; i < trkpts.length; i++) {
        let lat = parseFloat(trkpts[i].getAttribute('lat'));
        let lon = parseFloat(trkpts[i].getAttribute('lon'));
        let ele = parseFloat(trkpts[i].getElementsByTagName('ele')[0]?.textContent || 0);
        let timeStr = trkpts[i].getElementsByTagName('time')[0]?.textContent;

        if (!isNaN(lat) && !isNaN(lon)) {
            const t = new Date(timeStr || new Date().getTime() + i*1000);
            latlngs.push([lat, lon]); elevations.push(ele); times.push(t);
            
            let currentSpeed = 0;
            let currentPower = 0;

            if(i === 0) {
                startTime = t;
                rawSpeeds.push(0); rawPowers.push(0);
            } else {
                const prevLat = latlngs[i-1][0]; const prevLon = latlngs[i-1][1];
                const distDiff = getDistanceFromLatLonInKm(prevLat, prevLon, lat, lon);
                totalDist += distDiff;
                
                const prevEle = elevations[i-1];
                const eleDiff = ele - prevEle;
                if (eleDiff > 0) elevationGain += eleDiff;
                
                const timeDiffHours = (t - times[i-1]) / 3600000;
                
                if (timeDiffHours > 0.0000001 && distDiff > 0) {
                    currentSpeed = distDiff / timeDiffHours;
                }
                
                if(currentSpeed > 130 || isNaN(currentSpeed)) currentSpeed = rawSpeeds[i-1] || 0;
                
                const v = currentSpeed / 3.6; 
                const grade = (distDiff * 1000) > 0 ? eleDiff / (distDiff * 1000) : 0;
                if (v > 1) {
                    const pRolling = 9.8 * totalWeight * v * 0.005; 
                    const pGravity = 9.8 * totalWeight * v * grade; 
                    const pDrag = 0.5 * 1.225 * 0.4 * v * v * v;
                    currentPower = Math.max(0, pRolling + pGravity + pDrag);
                }
                rawSpeeds.push(currentSpeed);
                rawPowers.push(currentPower);
            }
            endTime = t;
            distances.push(totalDist);
        }
    }

    const cleanSpeeds = applyMedianFilter(rawSpeeds, 5);
    const smoothSpeeds = smoothArray(cleanSpeeds, 4);
    const smoothPowers = smoothArray(rawPowers, 6);

    let rideMaxSpeed = 0;
    if (smoothSpeeds.length > 0) {
        const validSpeeds = smoothSpeeds.filter(s => !isNaN(s) && s < 110);
        if (validSpeeds.length > 0) {
            rideMaxSpeed = Math.max(...validSpeeds);
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
            maxSpeed: parseFloat(rideMaxSpeed.toFixed(1)), 
            durationSec: durationMs / 1000,
            rideDate: startTime ? startTime.toISOString() : new Date().toISOString(),
            segments: segments
        },
        uiData: { latlngs, elevations, distances, speeds: smoothSpeeds, powers: smoothPowers, durationMs }
    };
}

function calculateFastestSegments(distances, times) {
    const results = [];
    if (!distances || distances.length === 0) return results;

    const totalDist = distances[distances.length - 1];

    // Loop verplicht elke 5km af
    for (let targetKm = 5; targetKm <= 100; targetKm += 5) {
        
        // Als de rit korter is dan het doel, stop de loop
        if (totalDist < targetKm) break;

        let bestTimeMs = Infinity;
        let bestStartIdx = -1;
        let bestEndIdx = -1;
        let startIdx = 0;
        let found = false;

        // Zoek het snelste stukje van exact 'targetKm' lengte
        for (let endIdx = 1; endIdx < distances.length; endIdx++) {
            // Schuif startpunt op zodat het stukje niet onnodig lang is
            while (startIdx < endIdx && (distances[endIdx] - distances[startIdx + 1]) >= targetKm) {
                startIdx++;
            }

            const currentDist = distances[endIdx] - distances[startIdx];

            // Check of dit een geldig segment is (minimaal de target afstand)
            if (currentDist >= targetKm) {
                const timeDiff = times[endIdx] - times[startIdx];
                if (timeDiff < bestTimeMs) {
                    bestTimeMs = timeDiff;
                    bestStartIdx = startIdx;
                    bestEndIdx = endIdx;
                    found = true;
                }
            }
        }

        if (found) {
            results.push({
                distance: targetKm,
                timeMs: bestTimeMs,
                speed: targetKm / (bestTimeMs / 3600000), // km/u
                startIdx: bestStartIdx,
                endIdx: bestEndIdx
            });
        }
    }
    
    // Sorteer op afstand (klein naar groot)
    return results.sort((a, b) => a.distance - b.distance);
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; const p = Math.PI/180;
    const a = 0.5 - Math.cos((lat2-lat1)*p)/2 + Math.cos(lat1*p)*Math.cos(lat2*p) * (1-Math.cos((lon2-lon1)*p))/2;
    return 12742 * Math.asin(Math.sqrt(a));
}

function updateMap(latlngs) {
    if (!map || !latlngs || latlngs.length === 0) return;
    
    if (polyline) map.removeLayer(polyline);
    if (segmentLayer) { map.removeLayer(segmentLayer); segmentLayer = null; } 
    
    polyline = L.polyline(latlngs, {color: '#fc4c02', weight: 4}).addTo(map);
    
    // paddingBottomRight: [x, y] -> y is de onderkant. 
    // We reserveren 280px aan de onderkant voor de grafieken.
    map.fitBounds(polyline.getBounds(), { 
        paddingTopLeft: [20, 20],
        paddingBottomRight: [20, 280], 
        animate: false 
    });
}

function updateChart(labels, elePoints, speedPoints, powerPoints) {
    const chartEl = document.getElementById('elevationChart');
    if(!chartEl) return;
    const ctx = chartEl.getContext('2d');
    const step = Math.ceil(labels.length / 500); 
    const filteredLabels = labels.filter((_, i) => i % step === 0);
    const filteredEle = elePoints.filter((_, i) => i % step === 0);
    const filteredSpeed = speedPoints ? speedPoints.filter((_, i) => i % step === 0) : [];
    const filteredPower = powerPoints ? powerPoints.filter((_, i) => i % step === 0) : [];

    if (elevationChart) elevationChart.destroy();
    
    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: filteredLabels.map(d => parseFloat(d).toFixed(1)),
            datasets: [
                { label: 'Hoogte (m)', data: filteredEle, borderColor: '#fc4c02', backgroundColor: 'rgba(252,76,2,0.1)', fill: true, pointRadius: 0, borderWidth: 2, yAxisID: 'y', order: 3 },
                { label: 'Snelheid (km/u)', data: filteredSpeed, borderColor: '#007bff', backgroundColor: 'transparent', fill: false, pointRadius: 0, borderWidth: 1.5, tension: 0.4, yAxisID: 'y1', order: 2 },
                { label: 'Vermogen (W)', data: filteredPower, borderColor: '#6f42c1', backgroundColor: 'transparent', fill: false, pointRadius: 0, borderWidth: 1, tension: 0.4, yAxisID: 'y2', order: 1, hidden: true }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            onHover: (event, elements) => {
                if (elements && elements.length > 0) { showPointOnMap(elements[0].index * step); } else { hidePointOnMap(); }
            },
            scales: { 
                x: { display: false }, 
                y: { type: 'linear', display: true, position: 'left', title: {display:true, text:'Hoogte'} },
                y1: { type: 'linear', display: true, position: 'right', grid: {drawOnChartArea:false}, title: {display:true, text:'Km/u'} },
                y2: { type: 'linear', display: false, position: 'right', grid: {drawOnChartArea:false}, min: 0 }
            },
            plugins: { legend: { display: true, labels: { boxWidth: 10 } } }
        }
    });
}

function showPointOnMap(index) {
    if (!currentRideData || !map) return;
    const safeIndex = Math.min(index, currentRideData.uiData.latlngs.length - 1);
    const latlng = currentRideData.uiData.latlngs[safeIndex];
    if (!latlng) return;
    if (!hoverMarker) { hoverMarker = L.circleMarker(latlng, { radius: 8, fillColor: "#007bff", color: "#ffffff", weight: 3, opacity: 1, fillOpacity: 1 }).addTo(map); } 
    else { hoverMarker.setLatLng(latlng); if (!map.hasLayer(hoverMarker)) hoverMarker.addTo(map); }
    hoverMarker.bringToFront();
}

function hidePointOnMap() { if (hoverMarker && map) { map.removeLayer(hoverMarker); hoverMarker = null; } }

async function saveToCloud() {
    if (!currentRideData) return;
    const btn = document.getElementById('save-cloud-btn');
    btn.innerText = "⏳..."; btn.disabled = true;
    try {
        await window.supabaseAuth.saveActivity({
            fileBlob: new Blob([currentRideData.xmlString], {type: 'application/xml'}),
            fileName: document.getElementById('drawn-ride-name')?.value || currentRideData.fileName,
            summary: currentRideData.summary
        });
        btn.innerText = "✅"; btn.style.background = "#28a745";
        if(window.updateDashboard) window.updateDashboard();
    } catch (e) { console.error(e); btn.innerText = "Opslaan"; btn.disabled = false; }
}

window.updateSegmentsUI = function(segments) {
    const list = document.getElementById('segments-list');
    if(!list) return;
    list.innerHTML = '';
    if(!segments || segments.length === 0) { list.innerHTML = '<small style="color:#888;">Geen segmenten.</small>'; return; }
    
    const clearBtn = document.createElement('div');
    clearBtn.id = 'clear-segment-btn';
    clearBtn.className = 'segment-card clickable hidden';
    clearBtn.style.textAlign = 'center'; clearBtn.style.justifyContent = 'center'; clearBtn.style.background = '#f8f9fa';
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
};

function highlightSegment(startIdx, endIdx, dist) {
    if (!map || !currentRideData) return;
    activeSegment = dist;
    
    // UI Update
    document.querySelectorAll('.segment-card').forEach(c => c.classList.remove('active-segment'));
    const activeCard = document.querySelector(`.segment-card[data-dist="${dist}"]`);
    if(activeCard) activeCard.classList.add('active-segment');
    
    const btn = document.getElementById('clear-segment-btn');
    if(btn) btn.classList.remove('hidden');

    // Kaart Update
    if (segmentLayer) { map.removeLayer(segmentLayer); }
    
    const fullPath = currentRideData.uiData.latlngs;
    const segmentPath = fullPath.slice(startIdx, endIdx + 1);
    
    segmentLayer = L.polyline(segmentPath, { color: '#00ff00', weight: 6, opacity: 1, lineCap: 'round' }).addTo(map);
    
    // AANGEPAST: Padding aan onderkant zodat segment boven de grafiek staat
    map.fitBounds(segmentLayer.getBounds(), { 
        paddingTopLeft: [50, 50],
        paddingBottomRight: [50, 300], // 300px ruimte onderin
        animate: true 
    });

    // Grafiek update (code blijft hetzelfde als voorheen, hieronder ingekort voor overzicht)
    if (elevationChart) {
        // ... (de grafiek highlight code die je al had) ...
        const originalDataset = elevationChart.data.datasets[0];
        const totalPoints = originalDataset.data.length;
        const realTotalPoints = currentRideData.uiData.latlngs.length;
        const ratio = totalPoints / realTotalPoints;
        const chartStart = Math.floor(startIdx * ratio);
        const chartEnd = Math.ceil(endIdx * ratio);
        const highlightData = new Array(totalPoints).fill(null);
        for (let i = 0; i < totalPoints; i++) { if (i >= chartStart && i <= chartEnd) { highlightData[i] = originalDataset.data[i]; } }
        
        if (elevationChart.data.datasets.length > 3) { elevationChart.data.datasets[3].data = highlightData; } 
        else { elevationChart.data.datasets.push({ label: 'Segment', data: highlightData, borderColor: '#00ff00', backgroundColor: 'rgba(0, 255, 0, 0.4)', borderWidth: 3, pointRadius: 0, fill: true, order: 0 }); }
        elevationChart.update();
    }
}

window.fixMaxSpeeds = async function() {
    const btn = document.getElementById('fix-data-btn');
    if(btn) { btn.innerText = "⏳ Bezig..."; btn.disabled = true; }

    const activities = await window.supabaseAuth.listActivities();
    let count = 0;

    for (const act of activities) {
        if (act.summary.type !== 'route') {
            try {
                console.log(`Fixing ${act.fileName}...`);
                const blob = await window.supabaseAuth.getActivityFile(act.id);
                const text = await blob.text();
                
                const newData = parseGPXData(text, act.fileName, true);
                
                if (newData) {
                    // Update zowel de nieuwe segmenten als de max snelheid
                    const updatedSummary = {
                        ...act.summary, 
                        maxSpeed: newData.summary.maxSpeed,
                        segments: newData.summary.segments // OVERSCHRIJF segmenten met de nieuwe 5km logica
                    };

                    const { error } = await window.supabase
                        .from('activities')
                        .update({ summary: updatedSummary })
                        .eq('id', act.id);

                    if (!error) {
                        count++;
                    } else {
                        console.error(`Fout bij ${act.fileName}:`, error);
                    }
                }
            } catch (e) {
                console.error(`Error loop:`, e);
            }
        }
    }

    alert(`Klaar! ${count} ritten bijgewerkt (Segmenten & Max Snelheid).`);
    if(btn) { btn.innerText = "✅ Klaar"; }
    location.reload(); 
};

window.parseGPXData = parseGPXData;