// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyBhzWWFFgrOH84J2RIW5o7l_8192iPtbOg",
    authDomain:        "code-vibe-df610.firebaseapp.com",
    projectId:         "code-vibe-df610",
    databaseURL:       "https://code-vibe-df610-default-rtdb.firebaseio.com",
    storageBucket:     "code-vibe-df610.firebasestorage.app",
    messagingSenderId: "747762490655",
    appId:             "1:747762490655:web:125516814620784cf3a42a"
};

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.database();

// ADMIN PAROLI
const ADMIN_PASS = "7777";

// ============================================================
// GLOBAL STATE
// ============================================================
const state = {
    targetId:   null,
    targetName: null,
    deviceId:   null,
    deviceName: null,
    map:        null,
    marker:     null,
    audioCtx:      null,
    oscillator:    null,
    gainNode:      null,
    alarmTimer:    null,
    alarmActive:   false,
    gpsWatchId:    null,
    heartbeatId:   null,
    dbListeners:   []
};

// ============================================================
// FIREBASE LISTENER BOSHQARUVI
// ============================================================
function addListener(ref, event, handler) {
    ref.on(event, handler);
    state.dbListeners.push({ ref, event });
}

function removeAllListeners() {
    state.dbListeners.forEach(({ ref, event }) => {
        try { ref.off(event); } catch (e) {}
    });
    state.dbListeners = [];
}

// ============================================================
// EKRANLAR
// ============================================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function setNavVisible(visible, title) {
    const nav = document.getElementById('top-nav');
    if (visible) {
        nav.classList.remove('hidden');
        document.getElementById('nav-title').textContent = title || 'SECURERTC';
    } else {
        nav.classList.add('hidden');
    }
}

function setConnStatus(online, label) {
    const dot = document.getElementById('conn-dot');
    const lbl = document.getElementById('conn-label');
    if (dot) dot.className = 'conn-dot ' + (online ? 'online' : 'offline');
    if (lbl) lbl.textContent = label || (online ? 'Online' : 'Offline');
}

// ============================================================
// BOSH SAHIFAGA QAYTISH
// ============================================================
function goHome() {
    stopAlarm();
    stopAlarmUI();
    if (state.audioCtx) {
        try { state.audioCtx.close(); } catch (e) {}
        state.audioCtx = null;
    }
    if (state.gpsWatchId !== null) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
        state.gpsWatchId = null;
    }
    if (state.heartbeatId !== null) {
        clearInterval(state.heartbeatId);
        state.heartbeatId = null;
    }
    removeAllListeners();
    state.targetId = null;
    state.targetName = null;
    state.deviceId = null;
    state.deviceName = null;
    state.map = null;
    state.marker = null;
    localStorage.clear();
    window.location.reload();
}

// ============================================================
// ILOVA YUKLANGANDA
// ============================================================
window.addEventListener('load', function () {
    const role = localStorage.getItem('srtc_role');
    const name = localStorage.getItem('srtc_name');
    const deviceId = localStorage.getItem('srtc_id');

    if (role === 'device' && name && deviceId) {
        startDeviceMode(name, deviceId);
    } else if (role === 'admin') {
        startAdminMode();
    } else {
        showScreen('screen-main');
    }

    db.ref('.info/connected').on('value', function (snap) {
        const online = snap.val() === true;
        setConnStatus(online, online ? 'Online' : 'Offline');
    });
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeChatModal();
        closeDeviceChatModal();
        closeAlarmModal();
    }
});

function handleOverlayClick(e, modalId) {
    if (e.target.id === modalId) {
        if (modalId === 'chat-modal') closeChatModal();
        if (modalId === 'device-chat-modal') closeDeviceChatModal();
        if (modalId === 'alarm-modal') closeAlarmModal();
    }
}

// ============================================================
// REJIM TANLASH
// ============================================================
function openAdmin() {
    const pass = prompt('Administrator paroli:');
    if (pass === null) return;
    if (pass !== ADMIN_PASS) {
        alert('Noto\'g\'ri parol. Kirish rad etildi.');
        return;
    }
    localStorage.setItem('srtc_role', 'admin');
    startAdminMode();
}

function openDevice() {
    const name = prompt('Qurilma nomi (masalan: "Ofis", "Darvoza"):');
    if (!name || !name.trim()) return;

    const deviceId = 'dev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    localStorage.setItem('srtc_role', 'device');
    localStorage.setItem('srtc_name', name.trim());
    localStorage.setItem('srtc_id', deviceId);

    startDeviceMode(name.trim(), deviceId);
}

// ============================================================
// QURILMA REJIMI
// ============================================================
async function startDeviceMode(deviceName, deviceId) {
    state.deviceId = deviceId;
    state.deviceName = deviceName;

    showScreen('screen-device');
    setNavVisible(true, 'QURILMA REJIMI');

    document.addEventListener('click', prepareAudio, { once: true });
    document.addEventListener('touchstart', prepareAudio, { once: true });

    document.getElementById('device-title').textContent = deviceName;
    document.getElementById('device-sub').textContent = 'Ulanmoqda...';
    document.getElementById('u-id').textContent = deviceId;
    document.getElementById('u-id').className = 'info-val mono';

    const deviceRef = db.ref('devices/' + deviceId);
    await deviceRef.set({
        name: deviceName,
        status: 'online',
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    }).catch(err => console.error('Device register error:', err));

    deviceRef.onDisconnect().update({
        status: 'offline',
        lastSeen: firebase.database.ServerValue.TIMESTAMP
    });

    setVal('u-status', 'Online', 'ok');
    setVal('u-server', 'Firebase Realtime DB', 'ok');
    document.getElementById('device-sub').textContent = 'Monitoring faol. Oynani yopmang.';

    startBattery(deviceId);
    startGPS(deviceId);
    listenAlarm(deviceId);
    initDeviceChat(deviceId);

    state.heartbeatId = setInterval(function () {
        if (!state.deviceId) return;
        db.ref('devices/' + state.deviceId).update({
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        }).catch(() => {});
    }, 30000);

    sendDeviceLog('Qurilma ishga tushdi: ' + deviceName, 'info');
}

// ============================================================
// BATAREYA
// ============================================================
function startBattery(deviceId) {
    if (!navigator.getBattery) {
        db.ref('devices/' + deviceId + '/info').set({ battery: 'Qo\'llab-quvvatlanmaydi' });
        setVal('u-battery', 'Qo\'llab-quvvatlanmaydi');
        return;
    }

    navigator.getBattery().then(function (bat) {
        function update() {
            const pct = Math.round(bat.level * 100) + '%';
            const label = pct + (bat.charging ? ' (Zaryad)' : '');
            db.ref('devices/' + deviceId + '/info').update({
                battery: pct,
                charging: bat.charging
            }).catch(() => {});
            setVal('u-battery', label, 'ok');
        }
        update();
        bat.addEventListener('levelchange', update);
        bat.addEventListener('chargingchange', update);
    }).catch(function (e) {
        sendDeviceLog('Batareya xatosi: ' + e.message, 'warn');
        setVal('u-battery', 'Xato', 'error');
    });
}

// ============================================================
// GPS
// ============================================================
function startGPS(deviceId) {
    if (!navigator.geolocation) {
        sendDeviceLog('Geolokatsiya qo\'llab-quvvatlanmaydi', 'warn');
        setVal('u-gps', 'Qo\'llab-quvvatlanmaydi', 'error');
        return;
    }

    state.gpsWatchId = navigator.geolocation.watchPosition(
        function (pos) {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const acc = Math.round(pos.coords.accuracy);

            db.ref('devices/' + deviceId + '/location').set({
                lat, lng, accuracy: acc, time: timeNow()
            }).catch(() => {});

            setVal('u-gps', lat.toFixed(5) + ', ' + lng.toFixed(5), 'ok');
        },
        function (err) {
            sendDeviceLog('GPS xatosi: ' + err.message, 'warn');
            setVal('u-gps', 'Xato: ' + err.message, 'error');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

// ============================================================
// ALARM TINGLOVCHI (qurilma tomoni)
// ============================================================
function listenAlarm(deviceId) {
    const ref = db.ref('devices/' + deviceId + '/commands/alarm');
    addListener(ref, 'value', function (snap) {
        const data = snap.val();
        if (!data) return;
        if (data.active) {
            prepareAudio();
            playAlarm(data.type || 'siren', (data.volume || 70) / 100);
            startAlarmUI();
        } else {
            stopAlarm();
            stopAlarmUI();
        }
    });
}

// ============================================================
// AUDIO TIZIMI
// ============================================================
function prepareAudio() {
    if (!state.audioCtx || state.audioCtx.state === 'closed') {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume().catch(() => {});
    }
}

function playAlarm(type, volume) {
    stopAlarm();
    prepareAudio();

    try {
        state.gainNode = state.audioCtx.createGain();
        state.gainNode.gain.value = Math.min(1.0, Math.max(0.0, volume));
        state.gainNode.connect(state.audioCtx.destination);

        state.oscillator = state.audioCtx.createOscillator();
        state.oscillator.type = type === 'siren' ? 'sawtooth' : type === 'alarm' ? 'square' : 'sine';
        state.oscillator.connect(state.gainNode);
        state.oscillator.start();

        runAlarmLoop(type);
        sendDeviceLog('Sirena ishga tushdi: ' + type, 'warn');
    } catch (e) {
        sendDeviceLog('Sirena xatosi: ' + e.message, 'error');
    }
}

function runAlarmLoop(type) {
    if (!state.oscillator || !state.audioCtx) return;

    function oneLoop() {
        if (!state.oscillator) return;
        const t = state.audioCtx.currentTime;

        if (type === 'siren') {
            state.oscillator.frequency.cancelScheduledValues(t);
            state.oscillator.frequency.setValueAtTime(700, t);
            state.oscillator.frequency.linearRampToValueAtTime(1300, t + 0.5);
            state.oscillator.frequency.linearRampToValueAtTime(700, t + 1.0);
        } else if (type === 'alarm') {
            state.oscillator.frequency.cancelScheduledValues(t);
            state.oscillator.frequency.setValueAtTime(440, t);
            state.oscillator.frequency.setValueAtTime(880, t + 0.25);
            state.oscillator.frequency.setValueAtTime(440, t + 0.50);
            state.oscillator.frequency.setValueAtTime(880, t + 0.75);
        } else {
            state.oscillator.frequency.setValueAtTime(1000, t);
        }
    }

    oneLoop();
    state.alarmTimer = setInterval(oneLoop, 1000);
}

function stopAlarm() {
    if (state.alarmTimer) { clearInterval(state.alarmTimer); state.alarmTimer = null; }
    if (state.oscillator) {
        try { state.oscillator.stop(); } catch (e) {}
        try { state.oscillator.disconnect(); } catch (e) {}
        state.oscillator = null;
    }
    if (state.gainNode) {
        try { state.gainNode.disconnect(); } catch (e) {}
        state.gainNode = null;
    }
}

function startAlarmUI() {
    if (state.alarmActive) return;
    state.alarmActive = true;

    const card = document.getElementById('device-card');
    if (card) card.style.boxShadow = '0 0 40px rgba(244,63,94,0.3)';

    const indicator = document.getElementById('alarm-indicator');
    if (indicator) indicator.classList.remove('hidden');

    const iconWrap = document.getElementById('device-icon-wrap');
    if (iconWrap) iconWrap.classList.add('alarm-active');
}

function stopAlarmUI() {
    if (!state.alarmActive) return;
    state.alarmActive = false;

    const card = document.getElementById('device-card');
    if (card) card.style.boxShadow = '';

    const indicator = document.getElementById('alarm-indicator');
    if (indicator) indicator.classList.add('hidden');

    const iconWrap = document.getElementById('device-icon-wrap');
    if (iconWrap) iconWrap.classList.remove('alarm-active');
}

// ============================================================
// QURILMA CHAT (device tomoni) - TUZATILGAN
// ============================================================
function initDeviceChat(deviceId) {
    const ref = db.ref('chats/' + deviceId);
    addListener(ref, 'child_added', function (snap) {
        const msg = snap.val();
        if (!msg) return;
        const isOwn = (msg.from === 'device');
        appendMessage('device-chat-messages', msg.text, isOwn, msg.time);
        if (!isOwn) playNotifSound();
    });
}

function sendDeviceMessage() {
    if (!state.deviceId) return;
    const input = document.getElementById('device-chat-input');
    const text = input.value.trim();
    if (!text) return;

    const msg = { from: 'device', text, time: timeNow(), ts: Date.now() };

    db.ref('chats/' + state.deviceId).push(msg).then(function () {
        // Tuzatildi: appendMessage() bu yerda EMAS! Faqat listener ishlaydi
        input.value = '';
        sendDeviceLog('Xabar yuborildi: ' + text.substring(0, 30), 'info');
    }).catch(function (err) {
        sendDeviceLog('Xabar xatosi: ' + err.message, 'error');
    });
}

function openDeviceChatModal() { toggleModal('device-chat-modal', true); document.getElementById('device-chat-input').focus(); }
function closeDeviceChatModal() { toggleModal('device-chat-modal', false); }

// ============================================================
// ADMIN REJIMI
// ============================================================
function startAdminMode() {
    showScreen('screen-admin');
    setNavVisible(true, 'ADMIN PANEL');

    const ref = db.ref('devices');
    addListener(ref, 'value', function (snap) {
        renderDevices(snap);
    });
}

function renderDevices(snap) {
    const list = document.getElementById('device-list');
    if (!list) return;

    list.innerHTML = '';
    let count = 0;

    snap.forEach(function (child) {
        const dev = child.val();
        if (dev.status !== 'online') return;

        count++;
        const id = child.key;
        const name = dev.name || 'Noma\'lum';
        const battery = (dev.info && dev.info.battery) ? dev.info.battery : '--';
        const charging = (dev.info && dev.info.charging) ? ' [Zaryad]' : '';

        const btn = document.createElement('button');
        btn.className = 'device-item' + (id === state.targetId ? ' selected' : '');
        btn.dataset.id = id;
        btn.innerHTML =
            '<div class="device-dot"></div>' +
            '<div class="device-name">' + escHtml(name) + '</div>' +
            '<div class="device-meta">Batareya: ' + escHtml(battery) + charging + '</div>' +
            '<div class="device-meta">' + id.substring(0, 14) + '...</div>';
        btn.onclick = function () { connectToDevice(id, name); };
        list.appendChild(btn);
    });

    document.getElementById('device-count').textContent = count + ' ta online';

    if (count === 0) {
        list.innerHTML = '<div class="empty-msg">Faol qurilmalar topilmadi</div>';
    }
}

function connectToDevice(id, name) {
    if (state.targetId) {
        const paths = ['info', 'location', 'logs'];
        paths.forEach(p => {
            const r = db.ref('devices/' + state.targetId + '/' + p);
            r.off();
            state.dbListeners = state.dbListeners.filter(l => l.ref !== r);
        });
        const chatRef = db.ref('chats/' + state.targetId);
        chatRef.off();
        state.dbListeners = state.dbListeners.filter(l => l.ref !== chatRef);
    }

    state.targetId = id;
    state.targetName = name;

    document.getElementById('target-name').textContent = name;
    const pill = document.getElementById('conn-status');
    pill.textContent = 'Ulangan';
    pill.className = 'status-pill online';

    const chatBtn = document.getElementById('chat-btn');
    if (chatBtn) chatBtn.classList.remove('hidden');

    document.querySelectorAll('.device-item').forEach(function (b) {
        b.classList.toggle('selected', b.dataset.id === id);
    });

    const infoRef = db.ref('devices/' + id + '/info');
    infoRef.on('value', function (snap) {
        const info = snap.val();
        if (!info) return;
        const chg = info.charging ? ' [Zaryad]' : '';
        document.getElementById('battery-display').textContent = 'Batareya: ' + (info.battery || '--') + chg;
    });
    state.dbListeners.push({ ref: infoRef, event: 'value' });

    const logBox = document.getElementById('log-box');
    if (logBox) {
        logBox.innerHTML = '';
        const logRef = db.ref('devices/' + id + '/logs').limitToLast(80);
        logRef.on('child_added', function (snap) {
            const e = snap.val();
            if (e) appendLog(e.time || '?', e.message || '', e.level || 'info');
        });
        state.dbListeners.push({ ref: logRef, event: 'child_added' });
    }

    const locRef = db.ref('devices/' + id + '/location');
    locRef.on('value', function (snap) {
        const loc = snap.val();
        if (!loc) return;
        updateMap(loc.lat, loc.lng);
        document.getElementById('gps-text').textContent =
            loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6) +
            (loc.accuracy ? ' ±' + loc.accuracy + 'm' : '');
    });
    state.dbListeners.push({ ref: locRef, event: 'value' });

    initAdminChat(id, name);

    appendLog(timeNow(), 'Qurilmaga ulandi: ' + name, 'info');
}

// ============================================================
// ADMIN CHAT (admin tomoni) - TUZATILGAN
// ============================================================
function initAdminChat(deviceId, deviceName) {
    const container = document.getElementById('admin-chat-messages');
    if (container) {
        container.innerHTML = '<div class="chat-welcome">' + escHtml(deviceName) + ' bilan chat</div>';
    }

    const chatRef = db.ref('chats/' + deviceId);
    chatRef.off();
    chatRef.on('child_added', function (snap) {
        const msg = snap.val();
        if (!msg) return;
        const isOwn = (msg.from === 'admin');
        appendMessage('admin-chat-messages', msg.text, isOwn, msg.time);
        if (!isOwn) playNotifSound();
    });
    state.dbListeners.push({ ref: chatRef, event: 'child_added' });
}

function sendAdminMessage() {
    if (!state.targetId) { alert('Avval qurilma tanlang.'); return; }
    const input = document.getElementById('admin-chat-input');
    const text = input.value.trim();
    if (!text) return;

    const msg = { from: 'admin', text, time: timeNow(), ts: Date.now() };

    db.ref('chats/' + state.targetId).push(msg).then(function () {
        // Tuzatildi: appendMessage() bu yerda EMAS! Faqat listener ishlaydi
        input.value = '';
        appendLog(timeNow(), state.targetName + ' ga xabar: ' + text.substring(0, 30), 'info');
    }).catch(function (err) {
        appendLog(timeNow(), 'Xabar xatosi: ' + err.message, 'error');
    });
}

function openChatModal() {
    if (!state.targetId) { alert('Avval qurilma tanlang.'); return; }
    document.getElementById('chat-modal-title').textContent = state.targetName + ' bilan chat';
    toggleModal('chat-modal', true);
    document.getElementById('admin-chat-input').focus();
}
function closeChatModal() { toggleModal('chat-modal', false); }

// ============================================================
// ADMIN BUYRUQLARI
// ============================================================
function triggerAlarm() {
    if (!state.targetId) { alert('Avval qurilma tanlang.'); return; }
    openAlarmModal();
}

function openAlarmModal() { toggleModal('alarm-modal', true); }
function closeAlarmModal() { toggleModal('alarm-modal', false); }

function confirmAlarm() {
    const type = document.getElementById('alarm-type').value;
    const volume = parseInt(document.getElementById('alarm-vol').value, 10);

    db.ref('devices/' + state.targetId + '/commands/alarm').set({
        active: true,
        type: type,
        volume: volume,
        time: Date.now()
    }).then(function () {
        appendLog(timeNow(), 'Sirena yuborildi: ' + type + ', ' + volume + '%', 'warn');
        closeAlarmModal();
    }).catch(function (err) {
        appendLog(timeNow(), 'Sirena xatosi: ' + err.message, 'error');
    });
}

function stopAlarmRemote() {
    if (!state.targetId) { alert('Avval qurilma tanlang.'); return; }
    db.ref('devices/' + state.targetId + '/commands/alarm').set({ active: false }).then(function () {
        appendLog(timeNow(), 'Sirena to\'xtatish buyrug\'i yuborildi.', 'info');
    });
}

// ============================================================
// XARITA (LEAFLET)
// ============================================================
function updateMap(lat, lng) {
    if (!state.map) {
        state.map = L.map('map').setView([lat, lng], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(state.map);
    }

    if (!state.marker) {
        state.marker = L.marker([lat, lng]).addTo(state.map);
    } else {
        state.marker.setLatLng([lat, lng]);
    }

    state.map.setView([lat, lng], state.map.getZoom());
}

// ============================================================
// LOG TIZIMI
// ============================================================
function sendDeviceLog(message, level) {
    if (!state.deviceId) return;
    db.ref('devices/' + state.deviceId + '/logs').push({
        time: timeNow(),
        message: String(message),
        level: level || 'info'
    }).catch(() => {});
}

function appendLog(time, message, level) {
    const box = document.getElementById('log-box');
    if (!box) return;

    const empty = box.querySelector('.empty-msg');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'log-entry ' + (level || 'info');
    div.textContent = '[' + time + '] ' + message;
    box.prepend(div);

    while (box.children.length > 200) {
        box.removeChild(box.lastChild);
    }
}

function clearLogs() {
    const box = document.getElementById('log-box');
    if (box) box.innerHTML = '<div class="empty-msg">Hodisalar oqimi tayyor</div>';
}

// ============================================================
// CHAT XABARLARI - LISTENER ORQALI QO'SHILADI (FAQAT BIR MARTA)
// ============================================================
function appendMessage(containerId, text, isOwn, time) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!time) time = timeNow();

    const welcome = container.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const item = document.createElement('div');
    item.className = 'msg-item ' + (isOwn ? 'own' : 'other');
    item.innerHTML =
        '<div class="msg-bubble">' + escHtml(text) + '</div>' +
        '<div class="msg-time">' + escHtml(time) + '</div>';

    container.appendChild(item);
    container.scrollTop = container.scrollHeight;

    while (container.children.length > 100) {
        container.removeChild(container.firstChild);
    }
}

// ============================================================
// BILDIRISHNOMA OVOZI
// ============================================================
function playNotifSound() {
    try {
        if (!state.audioCtx) return;
        const osc = state.audioCtx.createOscillator();
        const gain = state.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(state.audioCtx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.12;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.00001, state.audioCtx.currentTime + 0.35);
        osc.stop(state.audioCtx.currentTime + 0.35);
    } catch (e) {}
}

// ============================================================
// MODAL BOSHQARUVI
// ============================================================
function toggleModal(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    if (show) {
        el.classList.add('active');
    } else {
        el.classList.remove('active');
    }
}

// ============================================================
// UI YORDAMCHI FUNKSIYALAR
// ============================================================
function setVal(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls) el.className = 'info-val ' + cls;
}

function timeNow() {
    return new Date().toLocaleTimeString('uz-UZ');
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ============================================================
// JS XATOLARINI FIREBASE GA YUBORISH
// ============================================================
window.onerror = function (message, source, lineno) {
    if (state.deviceId) {
        sendDeviceLog('JS xato: ' + message + ' (satr: ' + lineno + ')', 'error');
    }
    return false;
};
