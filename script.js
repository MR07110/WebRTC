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

// Admin paroli — ishlab chiqarish muhitida bu backend tomonida saqlanishi kerak
const ADMIN_PASS = "7777";

// ============================================================
// GLOBAL HOLAT
// ============================================================
let userPeer       = null;   // User (qurilma) tomoni uchun Peer
let adminPeer      = null;   // Admin tomoni uchun Peer
let currentTargetId   = null; // Admin ulangan qurilma ID
let activeDbListeners = [];   // Barcha Firebase listenerlarni kuzatish uchun

let map    = null;
let marker = null;

let alarmOscillator  = null;
let alarmGain        = null;
let alarmInterval    = null;
let audioCtx         = null;

// ============================================================
// SAHIFA YUKLANGANDA AVTOMATIK TIK LASH
// ============================================================
window.onload = function () {
    const role = localStorage.getItem('myRTC_role');
    const name = localStorage.getItem('myRTC_deviceName');

    if (role === 'user' && name) {
        startUserMode(name);
    } else if (role === 'admin') {
        startAdminMode(true);
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
    if (userPeer)    { try { userPeer.destroy(); }  catch(e){} userPeer = null; }
    if (adminPeer)   { try { adminPeer.destroy(); } catch(e){} adminPeer = null; }
    if (audioCtx)    { try { audioCtx.close(); }   catch(e){} audioCtx = null; }

    // Firebase listenerlarini o'chirish
    activeDbListeners.forEach(({ ref, event }) => {
        try { ref.off(event); } catch(e){}
    });
    activeDbListeners = [];
    db.ref().off();

    localStorage.clear();
    window.location.reload();
}

/**
 * Firebase listenerini ro'yxatga olish (goHome da tozalash uchun)
 */
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
    localStorage.setItem('myRTC_role', 'user');
    localStorage.setItem('myRTC_deviceName', name.trim());
    startUserMode(name.trim());
}

function openAdmin() {
    const pass = prompt('Admin parolini kiriting:');
    if (pass === null) return;
    if (pass !== ADMIN_PASS) {
        alert("Parol noto'g'ri.");
        return;
    }
    localStorage.setItem('myRTC_role', 'admin');
    startAdminMode(false);
}

// ============================================================
// USER MODE (QURILMA TOMONI)
// ============================================================
async function startUserMode(deviceName) {
    showScreen('user-ui');
    document.getElementById('top-nav').classList.remove('hidden');
    document.getElementById('nav-title').textContent = 'Qurilma rejimi';

    setUserStatus('Ulanmoqda...', 'wait', 'wait');

    // AudioContext (alarm uchun) — foydalanuvchi interaksiyasidan keyin yaratilishi shart
    document.addEventListener('click', ensureAudioContext, { once: true });
    document.addEventListener('touchstart', ensureAudioContext, { once: true });

    // PeerJS Peer yaratish
    userPeer = new Peer();

    userPeer.on('open', function(id) {
        // Qurilmani Firebase ga ro'yxatdan o'tkazish
        const deviceRef = db.ref('devices/' + id);
        deviceRef.set({
            name:     deviceName,
            status:   'online',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });

        // Sahifa yopilganda offline qilish
        deviceRef.onDisconnect().update({
            status:   'offline',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });

        // UI yangilash
        document.getElementById('u-device-id').textContent = id;
        document.getElementById('u-status').textContent    = 'Onlayn';
        document.getElementById('u-status').className      = 'info-val ok';
        document.getElementById('u-server').textContent    = 'Firebase + PeerJS';
        document.getElementById('u-server').className      = 'info-val ok';
        setUserStatus('Tizim faol', 'ok', 'ok');

        // Nav holat
        setNavStatus(true, 'Onlayn');

        // Batareya ma'lumoti
        startBatteryMonitoring(id);

        // Firebase buyruqlarini tinglash
        listenAlarm(id);

        // GPS
        startGPS(id);
    });

    userPeer.on('error', function(err) {
        setUserStatus('Ulanish xatosi', 'error', 'error');
    });

    userPeer.on('disconnected', function() {
        userPeer.reconnect();
    });
}

function startBatteryMonitoring(peerId) {
    if (!navigator.getBattery) {
        db.ref('devices/' + peerId + '/info').update({ battery: 'Qo\'llab-quvvatlanmaydi', charging: false });
        document.getElementById('u-battery').textContent = 'Qo\'llab-quvvatlanmaydi';
        return;
    }

    navigator.getBattery().then(function(battery) {
        function updateBattery() {
            const pct = Math.floor(battery.level * 100) + '%';
            db.ref('devices/' + peerId + '/info').update({
                battery:  pct,
                charging: battery.charging
            }).catch(function(e) { console.error('Batareya yangilash xatosi:', e); });

            document.getElementById('u-battery').textContent = pct + (battery.charging ? ' (Quvvatlanmoqda)' : '');
            document.getElementById('u-battery').className   = 'info-val ok';
        }

        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
    }).catch(function(e) {});
}

function startGPS(peerId) {
    if (!navigator.geolocation) {
        document.getElementById('u-gps').textContent = 'Qo\'llab-quvvatlanmaydi';
        document.getElementById('u-gps').className  = 'info-val error';
        return;
    }

    navigator.geolocation.watchPosition(
        function(pos) {
            db.ref('devices/' + peerId + '/location').set({
                lat:      pos.coords.latitude,
                lng:      pos.coords.longitude,
                accuracy: Math.round(pos.coords.accuracy),
                time:     new Date().toLocaleTimeString('uz-UZ')
            }).catch(function() {});

            document.getElementById('u-gps').textContent = pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5);
            document.getElementById('u-gps').className  = 'info-val ok';
        },
        function(err) {
            document.getElementById('u-gps').textContent = 'Xatolik: ' + err.message;
            document.getElementById('u-gps').className  = 'info-val error';
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function listenAlarm(peerId) {
    const ref = db.ref('devices/' + peerId + '/commands/alarm');
    trackListener(ref, 'value', function(snap) {
        const data = snap.val();
        if (!data) return;

        if (data.active) {
            ensureAudioContext();
            playAlarm(data.type || 'siren', data.volume || 0.7);
        } else {
            stopAlarm();
        }
    });
}

// UI yordamchi funksiyalari (User mode)
function setUserStatus(title, titleClass, iconClass) {
    const titleEl = document.getElementById('user-title');
    const iconEl  = document.getElementById('user-status-icon');
    const subEl   = document.getElementById('user-sub');

    if (titleEl) titleEl.textContent = title;
    if (iconEl) {
        iconEl.className = 'user-status-icon ' + (iconClass === 'ok' ? 'online' : '');
    }
    if (subEl) {
        if (iconClass === 'ok')    subEl.textContent = 'Monitoring faol. Bu oynani yopmang.';
        if (iconClass === 'wait')  subEl.textContent = 'Tizim ishga tushirilmoqda...';
        if (iconClass === 'error') subEl.textContent = 'Ulanishda xatolik yuz berdi.';
    }
}

function setNavStatus(online, label) {
    const dot   = document.querySelector('#nav-conn-status .conn-dot');
    const lbl   = document.getElementById('nav-conn-label');
    if (dot) dot.className = 'conn-dot ' + (online ? 'online' : 'offline');
    if (lbl) lbl.textContent = label || (online ? 'Onlayn' : 'Oflayn');
}

// ============================================================
// ADMIN MODE (BOSHQARUV TOMONI)
// ============================================================
function startAdminMode(auto) {
    showScreen('admin-panel');
    document.getElementById('top-nav').classList.remove('hidden');
    document.getElementById('nav-title').textContent = 'Admin panel';
    setNavStatus(true, 'Admin');

    // Admin uchun Peer (faqat bir marta yaratish)
    if (!adminPeer) {
        adminPeer = new Peer();
        adminPeer.on('error', function(err) {
            console.error('[Admin Peer xatosi]', err.type, err.message || '');
        });
    }

    // Qurilmalar ro'yxatini real vaqtda kuzatish
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
        const id   = child.key;
        const name = device.name || 'Nomsiz';
        const bat  = (device.info && device.info.battery) ? device.info.battery : '--';
        const charging = (device.info && device.info.charging);

        const btn = document.createElement('button');
        btn.className = 'device-btn' + (id === currentTargetId ? ' selected' : '');
        btn.dataset.deviceId = id;
        btn.innerHTML =
            '<div class="device-btn-dot"></div>' +
            '<div class="device-btn-name">' + escapeHtml(name) + '</div>' +
            '<div class="device-btn-meta">Batareya: ' + escapeHtml(bat) + (charging ? ' [quvvatlanmoqda]' : '') + '</div>' +
            '<div class="device-btn-meta mono-text" style="font-size:10px;color:var(--text-muted)">' + id.substring(0,12) + '...</div>';
        btn.onclick = function() { connectToDevice(id, name); };
        list.appendChild(btn);
    });

    document.getElementById('device-count').textContent = count + ' ta';

    if (count === 0) {
        list.innerHTML = '<div class="device-empty">Onlayn qurilmalar yo\'q</div>';
    }
}

function connectToDevice(id, name) {
    // Avvalgi qurilma listenerlarini o'chirish
    if (currentTargetId) {
        db.ref('devices/' + currentTargetId + '/info').off();
        db.ref('devices/' + currentTargetId + '/location').off();
    }

    currentTargetId = id;

    // UI
    document.getElementById('target-name').textContent  = name;
    document.getElementById('connection-status').textContent  = 'Ulandi';
    document.getElementById('connection-status').className    = 'conn-badge connected';

    // Tanlangan qurilma tugmasini belgilash
    document.querySelectorAll('.device-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.deviceId === id);
    });

    // Batareya
    db.ref('devices/' + id + '/info').on('value', function(snap) {
        const info = snap.val();
        if (!info) return;
        const batt = info.battery || 'Noma\'lum';
        const charge = info.charging ? ' (quvvatlanmoqda)' : '';
        document.getElementById('battery-display').textContent = 'Batareya: ' + batt + charge;
    });

    // GPS
    db.ref('devices/' + id + '/location').on('value', function(snap) {
        const loc = snap.val();
        if (!loc) return;
        initMap(loc.lat, loc.lng);
        document.getElementById('gps-coords').textContent =
            loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6) +
            (loc.accuracy ? ' (+/-' + loc.accuracy + 'm)' : '');
    });
}

// ============================================================
// ADMIN BOSHQARUV FUNKSIYALARI
// ============================================================

function triggerAlarm() {
    if (!currentTargetId) { alert('Avval qurilmani tanlang.'); return; }

    const type   = prompt('Alarm turi (siren / beep / alarm):', 'siren');
    if (!type) return;

    const volRaw = prompt('Ovoz balandligi (0.1 dan 1.0 gacha):', '0.7');
    const vol    = Math.min(1.0, Math.max(0.1, parseFloat(volRaw) || 0.7));

    db.ref('devices/' + currentTargetId + '/commands/alarm').set({
        active: true,
        type:   type.trim(),
        volume: vol
    });
}

function stopAlarmRemote() {
    if (!currentTargetId) { alert('Avval qurilmani tanlang.'); return; }

    db.ref('devices/' + currentTargetId + '/commands/alarm').set({ active: false });
}

// ============================================================
// ALARM (LOCAL — USER QURILMASIDA ISHGA TUSHADI)
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

    } catch (e) {}
}

/**
 * Sirena effekti uchun chastota o'zgarishi loopi.
 * Har 1 soniyada bir marta chaqiriladi.
 */
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
            // beep: oddiy sabit chastota
            alarmOscillator.frequency.setValueAtTime(1000, t);
        }
    }

    oneLoop();
    // 1 soniyada bir marta yangilash — overlap yo'q
    alarmInterval = setInterval(oneLoop, 1000);
}

function stopAlarm() {
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    if (alarmOscillator) {
        try { alarmOscillator.stop(); } catch(e){}
        try { alarmOscillator.disconnect(); } catch(e){}
        alarmOscillator = null;
    }
    if (alarmGain) {
        try { alarmGain.disconnect(); } catch(e){}
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
            maxZoom:     19,
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

/** XSS uchun HTML escape */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
