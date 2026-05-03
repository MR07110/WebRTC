// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
const firebaseConfig = {
    apiKey:            "AIzaSyBhzWWFFgrOH84J2RIW5o7l_8192iPtbOg",
    authDomain:        "code-vibe-df610.firebaseapp.com",
    projectId:         "code-vibe-df610",
    databaseURL:       "https://code-vibe-df610-default-rtdb.firebaseio.com",
    storageBucket:     "code-vibe-df610.firebasestorage.app",
    messagingSenderId: "747762490655",
    appId:             "1:747762490655:web:125516814620784cf3a42a"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const ADMIN_PASS = "7777";

// ============================================================
// GLOBAL STATE
// ============================================================
let userPeer = null, adminPeer = null;
let localStream = null, currentCall = null;
let talkCall = null, talkStream = null, isTalking = false;
let isFlashlightOn = false, currentTargetId = null;
let activeDbListeners = [];
let map = null, marker = null;
let audioCtx = null, alarmOsc = null, alarmGain = null, alarmInterval = null;

// UI Elements
let adminLogContainer = null;

// Helper: Time
const now = () => new Date().toLocaleTimeString('en-US', { hour12: false });

// ============================================================
// LOGGING SYSTEM
// ============================================================
function sendLog(msg, level = 'info') {
    const id = userPeer?.id || 'unknown';
    db.ref(`devices/${id}/logs`).push({
        time: now(),
        message: String(msg),
        level: level
    }).catch(() => {});
}

function appendAdminLog(time, msg, level) {
    if (!adminLogContainer) adminLogContainer = document.getElementById('console-logs');
    if (!adminLogContainer) return;
    const empty = adminLogContainer.querySelector('.log-empty');
    if (empty) empty.remove();
    const line = document.createElement('div');
    line.className = `log-entry ${level}`;
    line.textContent = `[${time}] ${msg}`;
    adminLogContainer.prepend(line);
    while (adminLogContainer.children.length > 180) adminLogContainer.removeChild(adminLogContainer.lastChild);
}

function clearAdminLogs() {
    if (adminLogContainer) adminLogContainer.innerHTML = '<div class="log-empty">Logs cleared</div>';
}

// ============================================================
// SCREEN NAVIGATION
// ============================================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function goHome() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (talkStream) talkStream.getTracks().forEach(t => t.stop());
    if (currentCall) try { currentCall.close(); } catch(e) {}
    if (talkCall) try { talkCall.close(); } catch(e) {}
    if (userPeer) try { userPeer.destroy(); } catch(e) {}
    if (adminPeer) try { adminPeer.destroy(); } catch(e) {}
    activeDbListeners.forEach(({ ref, ev }) => ref.off(ev));
    activeDbListeners = [];
    db.ref().off();
    localStorage.clear();
    window.location.reload();
}

function trackListener(ref, event, handler) {
    ref.on(event, handler);
    activeDbListeners.push({ ref, event });
}

// ============================================================
// MODE ENTRY
// ============================================================
function openAdmin() {
    const pwd = prompt("Administrator authentication:");
    if (pwd !== ADMIN_PASS) return alert("Access denied.");
    localStorage.setItem('myRTC_role', 'admin');
    startAdminMode();
}

function openUser() {
    const name = prompt("Device alias:");
    if (!name?.trim()) return;
    localStorage.setItem('myRTC_role', 'user');
    localStorage.setItem('myRTC_deviceName', name.trim());
    startUserMode(name.trim());
}

window.onload = () => {
    const role = localStorage.getItem('myRTC_role');
    const name = localStorage.getItem('myRTC_deviceName');
    if (role === 'user' && name) startUserMode(name);
    else if (role === 'admin') startAdminMode();
    else showScreen('main-ui');
};

// ============================================================
// USER MODE (DEVICE)
// ============================================================
async function startUserMode(deviceName) {
    showScreen('user-ui');
    document.getElementById('top-nav').classList.remove('hidden');
    document.getElementById('nav-title').textContent = 'DEVICE MODE';
    setNavStatus(true, 'Online');
    setDeviceUIStatus('Connecting to cloud', 'wait');

    userPeer = new Peer();
    userPeer.on('open', async (id) => {
        sendLog(`Peer active: ${id}`);
        const devRef = db.ref(`devices/${id}`);
        await devRef.set({ name: deviceName, status: 'online', lastSeen: firebase.database.ServerValue.TIMESTAMP });
        devRef.onDisconnect().update({ status: 'offline', lastSeen: firebase.database.ServerValue.TIMESTAMP });
        
        document.getElementById('u-device-id').innerText = id;
        document.getElementById('u-status').innerHTML = 'Active';
        document.getElementById('u-status').className = 'matrix-value ok';
        setDeviceUIStatus('Secure channel established', 'ok');
        
        startBatteryMonitor(id);
        listenCommands(id);
        startGPS(id);
        await initCamera();
    });
    userPeer.on('error', e => sendLog(`Peer error: ${e.type}`, 'error'));
    userPeer.on('call', call => {
        if (localStream) {
            call.answer(localStream);
            currentCall = call;
            call.on('stream', stream => playAudioStream(stream));
            call.on('close', () => { currentCall = null; });
        } else call.close();
    });
}

async function initCamera() {
    const constraints = [{ video: { facingMode: 'environment' }, audio: true }, { video: true, audio: true }];
    for (const c of constraints) {
        try { localStream = await navigator.mediaDevices.getUserMedia(c); sendLog('Camera stream acquired'); return; } 
        catch(e) { sendLog(`Camera fail: ${e.message}`, 'warn'); }
    }
    sendLog('Camera permission denied', 'error');
}

function playAudioStream(stream) {
    const audio = new Audio();
    audio.srcObject = stream;
    audio.play().catch(() => { document.addEventListener('click', () => audio.play(), { once: true }); });
}

function startBatteryMonitor(peerId) {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(bat => {
        const update = () => {
            const pct = Math.floor(bat.level * 100) + '%';
            db.ref(`devices/${peerId}/info`).set({ battery: pct, charging: bat.charging });
            document.getElementById('u-battery').innerHTML = pct;
        };
        update();
        bat.addEventListener('levelchange', update);
        bat.addEventListener('chargingchange', update);
    });
}

function startGPS(peerId) {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(pos => {
        db.ref(`devices/${peerId}/location`).set({
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy, time: now()
        });
        document.getElementById('u-gps').innerHTML = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        document.getElementById('u-gps').className = 'matrix-value ok';
    }, err => { sendLog(`GPS error: ${err.message}`, 'warn'); }, { enableHighAccuracy: true });
}

function listenCommands(peerId) {
    const flashRef = db.ref(`devices/${peerId}/commands/flashlight`);
    trackListener(flashRef, 'value', async snap => {
        const val = snap.val();
        if (val === null) return;
        const track = localStream?.getVideoTracks()[0];
        if (track && track.getCapabilities?.().torch) {
            await track.applyConstraints({ advanced: [{ torch: !!val }] });
            isFlashlightOn = !!val;
        } else flashRef.set(false);
    });
    const alarmRef = db.ref(`devices/${peerId}/commands/alarm`);
    trackListener(alarmRef, 'value', snap => {
        const data = snap.val();
        if (data?.active) playAlarmLocal(data.type || 'siren', data.volume || 0.7);
        else stopAlarmLocal();
    });
}

function playAlarmLocal(type, vol) {
    stopAlarmLocal();
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    alarmGain = audioCtx.createGain();
    alarmGain.gain.value = Math.min(1, Math.max(0, vol));
    alarmGain.connect(audioCtx.destination);
    alarmOsc = audioCtx.createOscillator();
    alarmOsc.type = type === 'siren' ? 'sawtooth' : (type === 'alarm' ? 'square' : 'sine');
    alarmOsc.connect(alarmGain);
    alarmOsc.start();
    const freqLoop = () => {
        if (!alarmOsc) return;
        const t = audioCtx.currentTime;
        if (type === 'siren') {
            alarmOsc.frequency.cancelScheduledValues(t);
            alarmOsc.frequency.setValueAtTime(700, t);
            alarmOsc.frequency.linearRampToValueAtTime(1300, t + 0.5);
            alarmOsc.frequency.linearRampToValueAtTime(700, t + 1);
        } else if (type === 'alarm') {
            alarmOsc.frequency.setValueAtTime(880, t);
            alarmOsc.frequency.setValueAtTime(440, t + 0.3);
        }
    };
    freqLoop();
    alarmInterval = setInterval(freqLoop, 1000);
}

function stopAlarmLocal() {
    if (alarmInterval) clearInterval(alarmInterval);
    if (alarmOsc) { try { alarmOsc.stop(); alarmOsc.disconnect(); } catch(e){} alarmOsc = null; }
    if (alarmGain) { alarmGain.disconnect(); alarmGain = null; }
}

// ============================================================
// ADMIN MODE
// ============================================================
function startAdminMode() {
    showScreen('admin-panel');
    document.getElementById('top-nav').classList.remove('hidden');
    document.getElementById('nav-title').textContent = 'COMMAND CENTER';
    setNavStatus(true, 'Admin');
    adminLogContainer = document.getElementById('console-logs');
    if (!adminPeer) adminPeer = new Peer();
    db.ref('devices').on('value', snap => renderDevices(snap));
}

function renderDevices(snap) {
    const container = document.getElementById('device-list');
    if (!container) return;
    container.innerHTML = '';
    let count = 0;
    snap.forEach(child => {
        const dev = child.val();
        if (dev.status !== 'online') return;
        count++;
        const id = child.key, name = dev.name || 'Anonymous';
        const btn = document.createElement('button');
        btn.className = `device-btn ${id === currentTargetId ? 'selected' : ''}`;
        btn.innerHTML = `<div class="device-btn-dot"></div>
                         <div class="device-btn-name">${escapeHtml(name)}</div>
                         <div class="device-btn-meta">${id.slice(0,10)}...</div>`;
        btn.onclick = () => connectToDevice(id, name);
        container.appendChild(btn);
    });
    document.getElementById('device-count').innerText = `${count} online`;
    if (count === 0) container.innerHTML = '<div class="device-empty">No active devices</div>';
}

function connectToDevice(id, name) {
    if (currentTargetId) {
        db.ref(`devices/${currentTargetId}/info`).off();
        db.ref(`devices/${currentTargetId}/location`).off();
    }
    if (currentCall) try { currentCall.close(); } catch(e) {}
    currentTargetId = id;
    document.getElementById('target-name').innerText = name;
    document.getElementById('connection-status').innerHTML = 'Connecting...';
    document.getElementById('connection-status').className = 'conn-status offline';
    
    db.ref(`devices/${id}/info`).on('value', snap => {
        const info = snap.val();
        if (info) document.getElementById('battery-display').innerHTML = `Battery: ${info.battery || '--'}`;
    });
    db.ref(`devices/${id}/location`).on('value', snap => {
        const loc = snap.val();
        if (loc) {
            initMapView(loc.lat, loc.lng);
            document.getElementById('gps-coords').innerText = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
        }
    });
    startVideoCall(id);
}

function startVideoCall(targetId) {
    if (!adminPeer?.id) return;
    const silentStream = createSilentStream();
    currentCall = adminPeer.call(targetId, silentStream);
    currentCall.on('stream', stream => {
        const video = document.getElementById('remoteVideo');
        const placeholder = document.getElementById('video-placeholder');
        if (video) video.srcObject = stream;
        if (placeholder) placeholder.classList.add('hidden');
        document.getElementById('cam-badge').innerHTML = 'LIVE';
        document.getElementById('cam-badge').className = 'cam-status live';
        document.getElementById('connection-status').innerHTML = 'Connected';
        document.getElementById('connection-status').className = 'conn-status online';
        appendAdminLog(now(), `Video stream active: ${targetId.slice(0,8)}`, 'info');
    });
    currentCall.on('close', () => {
        const ph = document.getElementById('video-placeholder');
        if (ph) ph.classList.remove('hidden');
        document.getElementById('cam-badge').innerHTML = 'STANDBY';
        document.getElementById('cam-badge').className = 'cam-status offline';
    });
}

function createSilentStream() {
    if (!audioCtx) audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(dest);
    osc.start();
    return dest.stream;
}

function initMapView(lat, lng) {
    if (!map) {
        map = L.map('map').setView([lat, lng], 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: 'CartoDB'
        }).addTo(map);
    }
    if (!marker) marker = L.marker([lat, lng]).addTo(map);
    else marker.setLatLng([lat, lng]);
    map.setView([lat, lng]);
}

// ADMIN ACTIONS
async function toggleTalk() {
    if (!currentTargetId) return alert('Select a device first');
    if (!isTalking) {
        try {
            talkStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (talkCall) talkCall.close();
            talkCall = adminPeer.call(currentTargetId, talkStream);
            isTalking = true;
            talkCall.on('close', () => { isTalking = false; updateTalkUI(false); });
            updateTalkUI(true);
            appendAdminLog(now(), 'Two-way audio started', 'info');
        } catch(e) { alert('Microphone denied'); }
    } else {
        if (talkStream) talkStream.getTracks().forEach(t => t.stop());
        if (talkCall) talkCall.close();
        isTalking = false;
        updateTalkUI(false);
    }
}
function updateTalkUI(active) {
    const btn = document.getElementById('talkBtn');
    if (btn) active ? btn.classList.add('active') : btn.classList.remove('active');
}
function toggleFlashlight() {
    if (!currentTargetId) return;
    isFlashlightOn = !isFlashlightOn;
    db.ref(`devices/${currentTargetId}/commands/flashlight`).set(isFlashlightOn);
    const btn = document.getElementById('flashBtn');
    if (btn) btn.classList.toggle('active', isFlashlightOn);
}
function triggerAlarm() {
    if (!currentTargetId) return;
    const type = prompt('Alarm type: siren / alarm / beep', 'siren');
    if (!type) return;
    db.ref(`devices/${currentTargetId}/commands/alarm`).set({ active: true, type, volume: 0.8 });
}
function stopAlarmRemote() {
    if (!currentTargetId) return;
    db.ref(`devices/${currentTargetId}/commands/alarm`).set({ active: false });
}
// UI Helpers
function setNavStatus(online, label) {
    const dot = document.querySelector('#nav-conn-status .conn-dot');
    const lbl = document.getElementById('nav-conn-label');
    if (dot) dot.className = `conn-dot ${online ? 'online' : 'offline'}`;
    if (lbl) lbl.innerText = label;
}
function setDeviceUIStatus(msg, state) {
    const title = document.getElementById('user-title');
    const sub = document.getElementById('user-sub');
    if (title) title.innerText = state === 'ok' ? 'Fully Operational' : 'Synchronizing';
    if (sub) sub.innerText = msg;
}
function escapeHtml(str) { return String(str).replace(/[&<>]/g, function(m){ if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }
