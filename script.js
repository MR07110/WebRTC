// ============================================================
// FIREBASE KONFIGURATSIYASI
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

// Admin paroli
const ADMIN_PASS = "7777";

// ============================================================
// GLOBAL HOLAT
// ============================================================
let currentTargetId   = null;
let activeDbListeners = [];
let map               = null;
let marker            = null;

let alarmOscillator   = null;
let alarmGain         = null;
let alarmInterval     = null;
let audioCtx          = null;
let isAlarmActive     = false;

let currentDeviceId   = null;

// ============================================================
// LOG TIZIMI
// ============================================================

function sendLog(message, level = 'info') {
    if (!currentDeviceId) return;
    const entry = {
        time:    new Date().toLocaleTimeString('uz-UZ'),
        message: String(message),
        level:   level
    };
    db.ref('devices/' + currentDeviceId + '/logs').push(entry).catch(err => {
        console.error('[SecureRTC] Firebase log write failed:', err);
    });
}

function appendLog(time, message, level) {
    const container = document.getElementById('console-logs');
    if (!container) return;

    const empty = container.querySelector('.log-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'log-entry ' + (level || 'info');
    div.textContent = '[' + time + '] ' + message;
    container.prepend(div);

    while (container.children.length > 200) {
        container.removeChild(container.lastChild);
    }
}

function clearLogs() {
    const container = document.getElementById('console-logs');
    if (container) {
        container.innerHTML = '<div class="log-empty">Loglar tozalandi</div>';
    }
}

window.onerror = function(message, source, lineno) {
    if (currentDeviceId) {
        sendLog('JS xatosi: ' + message + ' | Qator: ' + lineno, 'error');
    }
    return false;
};

// ============================================================
// SAHIFA YUKLANGANDA
// ============================================================
window.onload = function () {
    const role = localStorage.getItem('secureRTC_role');
    const name = localStorage.getItem('secureRTC_deviceName');
    const deviceId = localStorage.getItem('secureRTC_deviceId');

    if (role === 'user' && name && deviceId) {
        startUserMode(name, deviceId);
    } else if (role === 'admin') {
        startAdminMode();
    } else {
        showScreen('main-ui');
    }
};

// ============================================================
// EKRANLAR
// ============================================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function goHome() {
    stopAlarm();
    stopAlarmLight();
    if (audioCtx) {
        try { audioCtx.close(); } catch(e) {}
        audioCtx = null;
    }

    activeDbListeners.forEach(({ ref, event }) => {
        try { ref.off(event); } catch(e) {}
    });
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
// BOSH SAHIFA: REJIM TANLASH
// ============================================================
function openUser() {
    const name = prompt('Qurilma nomini kiriting (masalan: "Salon" yoki "Eshik"):');
    if (!name || !name.trim()) return;
    
    const deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    
    localStorage.setItem('secureRTC_role', 'user');
    localStorage.setItem('secureRTC_deviceName', name.trim());
    localStorage.setItem('secureRTC_deviceId', deviceId);
    
    startUserMode(name.trim(), deviceId);
}

function openAdmin() {
    const pass = prompt('Admin parolini kiriting:');
    if (pass === null) return;
    if (pass !== ADMIN_PASS) {
        alert("Parol noto'g'ri.");
        return;
    }
    localStorage.setItem('secureRTC_role', 'admin');
    startAdminMode();
}

// ============================================================
// QIZIL CHIROQ FUNKSIYALARI
// ============================================================
function createAlarmLight() {
    let light = document.getElementById('alarm-light');
    if (!light) {
        const userCard = document.querySelector('.user-card');
        if (userCard) {
            userCard.style.position = 'relative';
            
            light = document.createElement('div');
            light.id = 'alarm-light';
            light.className = 'alarm-light';
            light.innerHTML = `
                <div class="alarm-light-inner">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                </div>
            `;
            userCard.appendChild(light);
        }
    }
    return document.getElementById('alarm-light');
}

function startAlarmLight() {
    if (isAlarmActive) return;
    isAlarmActive = true;
    
    const light = createAlarmLight();
    if (light) {
        light.classList.add('active');
    }
    
    const statusIcon = document.getElementById('user-status-icon');
    if (statusIcon) {
        statusIcon.classList.add('alarm-active');
    }
    
    sendLog('⚠️ SIGNAL: Qizil chiroq faollashtirildi', 'warn');
}

function stopAlarmLight() {
    if (!isAlarmActive) return;
    isAlarmActive = false;
    
    const light = document.getElementById('alarm-light');
    if (light) {
        light.classList.remove('active');
    }
    
    const statusIcon = document.getElementById('user-status-icon');
    if (statusIcon) {
        statusIcon.classList.remove('alarm-active');
    }
}

// ============================================================
// USER MODE (QURILMA TOMONI)
// ============================================================
async function startUserMode(deviceName, deviceId) {
    currentDeviceId = deviceId;
    
    showScreen('user-ui');
    document.getElementById('top-nav').classList.remove('hidden');
    document.getElementById('nav-title').textContent = 'Qurilma rejimi';
    
    setUserStatus('Ulanmoqda...', 'wait', 'wait');
    stopAlarmLight();

    document.addEventListener('click', ensureAudioContext, { once: true });
    document.addEventListener('touchstart', ensureAudioContext, { once: true });

    sendLog('Qurilma ishga tushmoqda: ' + deviceName, 'info');

    // Qurilmani Firebase ga ro'yxatdan o'tkazish
    const deviceRef = db.ref('devices/' + deviceId);
    await deviceRef.set({
        name:     deviceName,
        status:   'online',
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
        type:     'mobile'
    });

    deviceRef.onDisconnect().update({
        status:   'offline',
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    });

    // UI yangilash
    document.getElementById('u-device-id').textContent = deviceId;
    document.getElementById('u-status').textContent = 'Onlayn';
    document.getElementById('u-status').className = 'info-val ok';
    document.getElementById('u-server').textContent = 'Firebase Realtime DB';
    document.getElementById('u-server').className = 'info-val ok';
    setUserStatus('Tizim faol', 'ok', 'ok');
    setNavStatus(true, 'Onlayn');

    // Batareya monitoringi
    startBatteryMonitoring(deviceId);

    // Firebase buyruqlarini tinglash
    listenAlarm(deviceId);

    // GPS
    startGPS(deviceId);

    // Heartbeat - har 30 sekundda lastSeen yangilash
    setInterval(() => {
        if (currentDeviceId) {
            db.ref('devices/' + currentDeviceId).update({
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            }).catch(() => {});
        }
    }, 30000);

    sendLog('✅ Qurilma tayyor. Monitoring faol.', 'info');
}

function startBatteryMonitoring(deviceId) {
    if (!navigator.getBattery) {
        db.ref('devices/' + deviceId + '/info').set({ battery: 'Qo\'llab-quvvatlanmaydi', charging: false });
        document.getElementById('u-battery').textContent = 'Qo\'llab-quvvatlanmaydi';
        return;
    }

    navigator.getBattery().then(function(battery) {
        function updateBattery() {
            const pct = Math.floor(battery.level * 100) + '%';
            db.ref('devices/' + deviceId + '/info').update({
                battery:  pct,
                charging: battery.charging
            }).catch(function(e) { console.error('Batareya yangilash xatosi:', e); });

            document.getElementById('u-battery').textContent = pct + (battery.charging ? ' (Quvvatlanmoqda)' : '');
            document.getElementById('u-battery').className = 'info-val ok';
        }

        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
    }).catch(function(e) {
        sendLog('Batareya API xatosi: ' + e.message, 'warn');
    });
}

function startGPS(deviceId) {
    if (!navigator.geolocation) {
        sendLog('Geolokatsiya qo\'llab-quvvatlanmaydi.', 'warn');
        document.getElementById('u-gps').textContent = 'Qo\'llab-quvvatlanmaydi';
        document.getElementById('u-gps').className = 'info-val error';
        return;
    }

    navigator.geolocation.watchPosition(
        function(pos) {
            db.ref('devices/' + deviceId + '/location').set({
                lat:      pos.coords.latitude,
                lng:      pos.coords.longitude,
                accuracy: Math.round(pos.coords.accuracy),
                time:     new Date().toLocaleTimeString('uz-UZ')
            }).catch(function() {});

            document.getElementById('u-gps').textContent = pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5);
            document.getElementById('u-gps').className = 'info-val ok';
        },
        function(err) {
            sendLog('GPS xatosi: ' + err.message, 'warn');
            document.getElementById('u-gps').textContent = 'Xatolik: ' + err.message;
            document.getElementById('u-gps').className = 'info-val error';
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function listenAlarm(deviceId) {
    const ref = db.ref('devices/' + deviceId + '/commands/alarm');
    trackListener(ref, 'value', function(snap) {
        const data = snap.val();
        if (!data) return;

        if (data.active) {
            ensureAudioContext();
            playAlarm(data.type || 'siren', data.volume || 0.7);
            startAlarmLight();  // 🔴 Qizil chiroq yonadi
        } else {
            stopAlarm();
            stopAlarmLight();   // 🔴 Qizil chiroq o'chadi
        }
    });
}

function setUserStatus(title, titleClass, iconClass) {
    const titleEl = document.getElementById('user-title');
    const iconEl = document.getElementById('user-status-icon');
    const subEl = document.getElementById('user-sub');

    if (titleEl) titleEl.textContent = title;
    if (iconEl) {
        iconEl.className = 'user-status-icon ' + (iconClass === 'ok' ? 'online' : '');
    }
    if (subEl) {
        if (iconClass === 'ok') subEl.textContent = 'Monitoring faol. Bu oynani yopmang.';
        if (iconClass === 'wait') subEl.textContent = 'Tizim ishga tushirilmoqda...';
        if (iconClass === 'error') subEl.textContent = 'Ulanishda xatolik yuz berdi.';
    }
}

function setNavStatus(online, label) {
    const dot = document.querySelector('#nav-conn-status .conn-dot');
    const lbl = document.getElementById('nav-conn-label');
    if (dot) dot.className = 'conn-dot ' + (online ? 'online' : 'offline');
    if (lbl) lbl.textContent = label || (online ? 'Onlayn' : 'Oflayn');
}

// ============================================================
// ADMIN MODE (BOSHQARUV TOMONI)
// ============================================================
function startAdminMode() {
    showScreen('admin-panel');
    document.getElementById('top-nav').classList.remove('hidden');
    document.getElementById('nav-title').textContent = 'Admin panel';
    setNavStatus(true, 'Admin');

    const devicesRef = db.ref('devices');
    trackListener(devicesRef, 'value', function(snap) {
        renderDeviceList(snap);
    });
}

function renderDeviceList(snap) {
    const list = document.getElementById('device-list');
    if (!list) return;

    list.innerHTML = '';
    let count = 0;

    snap.forEach(function(child) {
        const device = child.val();
        if (device.status !== 'online') return;

        count++;
        const id = child.key;
        const name = device.name || 'Nomsiz';
        const bat = (device.info && device.info.battery) ? device.info.battery : '--';
        const charging = (device.info && device.info.charging);

        const btn = document.createElement('button');
        btn.className = 'device-btn' + (id === currentTargetId ? ' selected' : '');
        btn.dataset.deviceId = id;
        btn.innerHTML =
            '<div class="device-btn-dot"></div>' +
            '<div class="device-btn-name">' + escapeHtml(name) + '</div>' +
            '<div class="device-btn-meta">🔋 ' + escapeHtml(bat) + (charging ? ' ⚡' : '') + '</div>' +
            '<div class="device-btn-meta mono-text" style="font-size:10px;color:var(--text-muted)">' + id.substring(0, 12) + '...</div>';
        btn.onclick = function() { connectToDevice(id, name); };
        list.appendChild(btn);
    });

    document.getElementById('device-count').textContent = count + ' ta';

    if (count === 0) {
        list.innerHTML = '<div class="device-empty">📱 Onlayn qurilmalar yo\'q</div>';
    }
}

function connectToDevice(id, name) {
    if (currentTargetId) {
        db.ref('devices/' + currentTargetId + '/info').off();
        db.ref('devices/' + currentTargetId + '/location').off();
        db.ref('devices/' + currentTargetId + '/logs').off();
    }

    currentTargetId = id;

    document.getElementById('target-name').textContent = name;
    document.getElementById('connection-status').textContent = '✅ Ulandi';
    document.getElementById('connection-status').className = 'conn-badge connected';

    document.querySelectorAll('.device-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.deviceId === id);
    });

    // Batareya
    db.ref('devices/' + id + '/info').on('value', function(snap) {
        const info = snap.val();
        if (!info) return;
        const batt = info.battery || 'Noma\'lum';
        const charge = info.charging ? ' ⚡ quvvatlanmoqda' : '';
        document.getElementById('battery-display').textContent = '🔋 Batareya: ' + batt + charge;
    });

    // Loglar
    const logBox = document.getElementById('console-logs');
    if (logBox) {
        logBox.innerHTML = '';
        db.ref('devices/' + id + '/logs').limitToLast(80).on('child_added', function(snap) {
            const entry = snap.val();
            if (entry) appendLog(entry.time || '?', entry.message || '', entry.level || 'info');
        });
    }

    // GPS
    db.ref('devices/' + id + '/location').on('value', function(snap) {
        const loc = snap.val();
        if (!loc) return;
        initMap(loc.lat, loc.lng);
        document.getElementById('gps-coords').textContent =
            '📍 ' + loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6) +
            (loc.accuracy ? ' (🎯 +/-' + loc.accuracy + 'm)' : '');
    });

    appendLog(now(), '🔗 Qurilmaga ulandi: ' + name, 'info');
}

// ============================================================
// ADMIN BOSHQARUV FUNKSIYALARI
// ============================================================

function triggerAlarm() {
    if (!currentTargetId) { alert('❌ Avval qurilmani tanlang.'); return; }

    const type = prompt('🚨 Alarm turi (siren / beep / alarm):', 'siren');
    if (!type) return;

    const volRaw = prompt('🔊 Ovoz balandligi (0.1 dan 1.0 gacha):', '0.7');
    const vol = Math.min(1.0, Math.max(0.1, parseFloat(volRaw) || 0.7));

    db.ref('devices/' + currentTargetId + '/commands/alarm').set({
        active: true,
        type: type.trim(),
        volume: vol,
        time: Date.now()
    });

    appendLog(now(), '🔔 Sirena buyrug\'i yuborildi: ' + type + ', ovoz: ' + vol, 'info');
}

function stopAlarmRemote() {
    if (!currentTargetId) { alert('❌ Avval qurilmani tanlang.'); return; }

    db.ref('devices/' + currentTargetId + '/commands/alarm').set({ active: false });
    appendLog(now(), '🔕 Sirenani to\'xtatish buyrug\'i yuborildi.', 'info');
}

// ============================================================
// ALARM (USER QURILMASIDA)
// ============================================================
function ensureAudioContext() {
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(function() {});
    }
}

function playAlarm(type, volume) {
    stopAlarm();
    ensureAudioContext();

    try {
        alarmGain = audioCtx.createGain();
        alarmGain.gain.value = Math.min(1.0, Math.max(0.0, volume));
        alarmGain.connect(audioCtx.destination);

        alarmOscillator = audioCtx.createOscillator();
        alarmOscillator.connect(alarmGain);

        if (type === 'siren') {
            alarmOscillator.type = 'sawtooth';
        } else if (type === 'alarm') {
            alarmOscillator.type = 'square';
        } else {
            alarmOscillator.type = 'sine';
        }

        alarmOscillator.start();
        scheduleAlarmLoop(type);

        sendLog('🔊 Alarm boshlandi: ' + type + ', ovoz: ' + volume, 'warn');

    } catch (e) {
        sendLog('❌ Alarm boshlashda xatolik: ' + e.message, 'error');
    }
}

function scheduleAlarmLoop(type) {
    if (!alarmOscillator || !audioCtx) return;

    function oneLoop() {
        if (!alarmOscillator) return;
        const t = audioCtx.currentTime;

        if (type === 'siren') {
            alarmOscillator.frequency.cancelScheduledValues(t);
            alarmOscillator.frequency.setValueAtTime(700, t);
            alarmOscillator.frequency.linearRampToValueAtTime(1300, t + 0.5);
            alarmOscillator.frequency.linearRampToValueAtTime(700, t + 1.0);
        } else if (type === 'alarm') {
            alarmOscillator.frequency.cancelScheduledValues(t);
            alarmOscillator.frequency.setValueAtTime(440, t);
            alarmOscillator.frequency.setValueAtTime(880, t + 0.25);
            alarmOscillator.frequency.setValueAtTime(440, t + 0.50);
            alarmOscillator.frequency.setValueAtTime(880, t + 0.75);
        } else {
            alarmOscillator.frequency.setValueAtTime(1000, t);
        }
    }

    oneLoop();
    alarmInterval = setInterval(oneLoop, 1000);
}

function stopAlarm() {
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    if (alarmOscillator) {
        try { alarmOscillator.stop(); } catch(e) {}
        try { alarmOscillator.disconnect(); } catch(e) {}
        alarmOscillator = null;
    }
    if (alarmGain) {
        try { alarmGain.disconnect(); } catch(e) {}
        alarmGain = null;
    }
}

// ============================================================
// XARITA (LEAFLET)
// ============================================================
function initMap(lat, lng) {
    if (!map) {
        map = L.map('map').setView([lat, lng], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap mualliflari'
        }).addTo(map);
    }

    if (!marker) {
        marker = L.marker([lat, lng]).addTo(map);
    } else {
        marker.setLatLng([lat, lng]);
    }

    map.setView([lat, lng], map.getZoom());
}

// ============================================================
// YORDAMCHI FUNKSIYALAR
// ============================================================

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function now() {
    return new Date().toLocaleTimeString('uz-UZ');
}
