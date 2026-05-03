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
let localStream    = null;   // User kamerasi + mikrofon
let currentCall    = null;   // Joriy WebRTC call (video)
let talkCall       = null;   // Admin->User ovoz call
let talkStream     = null;   // Admin mikrofon stream
let isTalking      = false;
let isFlashlightOn = false;

let currentTargetId   = null; // Admin ulangan qurilma ID
let activeDbListeners = [];   // Barcha Firebase listenerlarni kuzatish uchun

let map    = null;
let marker = null;

let alarmOscillator  = null;
let alarmGain        = null;
let alarmInterval    = null;
let audioCtx         = null;

// ============================================================
// LOG TIZIMI
// ============================================================

/**
 * User qurilmasidan Firebase ga log yuboradi.
 * @param {string} message
 * @param {'info'|'warn'|'error'} level
 */
function sendLog(message, level = 'info') {
    const id = (userPeer && userPeer.id) ? userPeer.id : 'no-peer-id';
    const entry = {
        time:    new Date().toLocaleTimeString('uz-UZ'),
        message: String(message),
        level:   level
    };
    db.ref('devices/' + id + '/logs').push(entry).catch(err => {
        console.error('[SecureRTC] Firebase log write failed:', err);
    });
}

/**
 * Admin paneldagi log konteyneriga yozadi.
 * @param {string} time
 * @param {string} message
 * @param {'info'|'warn'|'error'} level
 */
function appendLog(time, message, level) {
    const container = document.getElementById('console-logs');
    if (!container) return;

    const empty = container.querySelector('.log-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'log-entry ' + (level || 'info');
    div.textContent = '[' + time + '] ' + message;
    container.prepend(div);

    // Juda ko'p log bo'lsa eskisini o'chirish
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

// Brauzer xatolarini ushlash va Firebase ga yuborish
window.onerror = function(message, source, lineno) {
    if (userPeer && userPeer.id) {
        sendLog('JS xatosi: ' + message + ' | Qator: ' + lineno, 'error');
    }
    return false;
};

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
    // Barcha media va ulanishlarni to'xtatish
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    if (talkStream) {
        talkStream.getTracks().forEach(t => t.stop());
        talkStream = null;
    }
    stopAlarm();
    if (currentCall) { try { currentCall.close(); } catch(e){} currentCall = null; }
    if (talkCall)    { try { talkCall.close(); }    catch(e){} talkCall = null; }
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
        sendLog('PeerJS ulandi. ID: ' + id, 'info');

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
        listenFlashlight(id);
        listenAlarm(id);

        // GPS
        startGPS(id);

        sendLog('Qurilma tayyor. Kamera va mikrofon ochilmoqda.', 'info');
    });

    userPeer.on('error', function(err) {
        sendLog('PeerJS xatosi: ' + err.type + ' - ' + (err.message || ''), 'error');
        setUserStatus('Ulanish xatosi', 'error', 'error');
    });

    userPeer.on('disconnected', function() {
        sendLog('PeerJS uzildi. Qayta ulanmoqda...', 'warn');
        userPeer.reconnect();
    });

    // Kamerani va mikrofonni ochish
    await openCamera();

    // Incoming calllarni qabul qilish (admin video so'raganida)
    userPeer.on('call', function(call) {
        sendLog('Admin qo\'ng\'iroq qilmoqda, javob berilmoqda.', 'info');

        if (!localStream) {
            sendLog('localStream mavjud emas, qo\'ng\'iroqqa javob berib bo\'lmadi.', 'error');
            call.close();
            return;
        }

        call.answer(localStream);
        currentCall = call;

        call.on('stream', function(remoteStream) {
            // Admin ovozini qurilmada chiqarish
            sendLog('Admin ovoz stream qabul qilindi.', 'info');
            playRemoteAudio(remoteStream);
        });

        call.on('close', function() {
            sendLog('Admin qo\'ng\'iroqni tugatdi.', 'info');
            currentCall = null;
        });

        call.on('error', function(err) {
            sendLog('Call xatosi: ' + (err.message || err), 'error');
        });
    });
}

/**
 * Qurilmada audio stream chiqarish.
 * autoplay bloklansa foydalanuvchi bosishini kutadi.
 */
function playRemoteAudio(stream) {
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.volume = 1.0;
    audio.play().catch(function() {
        sendLog('Avtomatik audio bloklandi. Foydalanuvchi bosishi kutilmoqda.', 'warn');
        const unlock = function() {
            audio.play().catch(function(e) {
                sendLog('Audio qayta urinish: ' + e.message, 'warn');
            });
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        };
        document.addEventListener('click', unlock);
        document.addEventListener('touchstart', unlock);
    });
}

async function openCamera() {
    const constraints = [
        { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true },
        { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: true },
        { video: true, audio: true }
    ];

    for (const c of constraints) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia(c);
            sendLog('Kamera ochildi: ' + JSON.stringify(c.video), 'info');
            document.getElementById('u-camera').textContent = 'Faol';
            document.getElementById('u-camera').className  = 'info-val ok';
            return;
        } catch (e) {
            sendLog('Kamera ochishda xatolik (' + (e.name || e.message) + '), keyingi sozlamani sinab ko\'rilmoqda.', 'warn');
        }
    }

    sendLog('Kamera yoki mikrofon ruxsati berilmadi. Hamma usullar muvaffaqiyatsiz.', 'error');
    document.getElementById('u-camera').textContent = 'Ruxsat yo\'q';
    document.getElementById('u-camera').className  = 'info-val error';
    alert('Kamera yoki mikrofon ruxsati berilmadi. Iltimos, brauzer sozlamalarini tekshiring.');
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
    }).catch(function(e) {
        sendLog('Batareya API xatosi: ' + e.message, 'warn');
    });
}

function startGPS(peerId) {
    if (!navigator.geolocation) {
        sendLog('Geolokatsiya bu brauzerda qo\'llab-quvvatlanmaydi.', 'warn');
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
            sendLog('GPS xatosi: ' + err.message, 'warn');
            document.getElementById('u-gps').textContent = 'Xatolik: ' + err.message;
            document.getElementById('u-gps').className  = 'info-val error';
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function listenFlashlight(peerId) {
    const ref = db.ref('devices/' + peerId + '/commands/flashlight');
    trackListener(ref, 'value', async function(snap) {
        const val = snap.val();
        if (val === null) return;

        sendLog('Fonar buyrug\'i qabul qilindi: ' + val, 'info');

        if (!localStream) {
            sendLog('localStream yo\'q, fonar ishlatib bo\'lmaydi.', 'error');
            ref.set(false);
            return;
        }

        const track = localStream.getVideoTracks()[0];
        if (!track) {
            sendLog('Video trek topilmadi.', 'error');
            ref.set(false);
            return;
        }

        const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};

        if (!capabilities.torch) {
            sendLog('Bu qurilmada fonar (torch) qo\'llab-quvvatlanmaydi.', 'warn');
            ref.set(false);
            return;
        }

        try {
            await track.applyConstraints({ advanced: [{ torch: !!val }] });
            isFlashlightOn = !!val;
            sendLog('Fonar ' + (val ? 'yoqildi' : 'o\'chirildi') + '.', 'info');
        } catch (e) {
            sendLog('Fonar applyConstraints xatosi: ' + e.message, 'error');
            ref.set(false);
        }
    });
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
        db.ref('devices/' + currentTargetId + '/logs').off();
    }

    // Avvalgi callni yopish
    if (currentCall) {
        try { currentCall.close(); } catch(e){}
        currentCall = null;
    }

    currentTargetId = id;

    // UI
    document.getElementById('target-name').textContent  = name;
    document.getElementById('connection-status').textContent  = 'Ulanmoqda...';
    document.getElementById('connection-status').className    = 'conn-badge disconnected';

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

    // Loglar
    const logBox = document.getElementById('console-logs');
    logBox.innerHTML = '';
    db.ref('devices/' + id + '/logs').limitToLast(80).on('child_added', function(snap) {
        const entry = snap.val();
        if (entry) appendLog(entry.time || '?', entry.message || '', entry.level || 'info');
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

    // Video call: admin o'z mikrofon streamini yuboradi, qurilmadan video keladi.
    // Bo'sh MediaStream yuborilsa PeerJS xatolik beradi,
    // shuning uchun faqat bitta silent audio track yuboramiz.
    startVideoCall(id);
}

async function startVideoCall(targetId) {
    if (!adminPeer || !adminPeer.id) {
        appendLog(now(), 'adminPeer tayyor emas. Bir oz kutib qayta urinib ko\'ring.', 'warn');
        return;
    }

    try {
        // Admin tomonidan bitta silent audio track (qurilma ovozni eshitishi uchun emas,
        // PeerJS ga stream kerak bo'lgani uchun). Asosiy audio talkBtn orqali yuboriladi.
        const silentStream = createSilentStream();

        currentCall = adminPeer.call(targetId, silentStream);

        currentCall.on('stream', function(remoteStream) {
            const video = document.getElementById('remoteVideo');
            const placeholder = document.getElementById('video-placeholder');
            if (video) {
                video.srcObject = remoteStream;
                video.play().catch(function() {});
            }
            if (placeholder) placeholder.classList.add('hidden');

            const camBadge = document.getElementById('cam-badge');
            if (camBadge) { camBadge.textContent = 'LIVE'; camBadge.className = 'cam-badge live'; }

            document.getElementById('connection-status').textContent = 'Ulandi';
            document.getElementById('connection-status').className   = 'conn-badge connected';

            appendLog(now(), 'Video stream qabul qilindi.', 'info');
        });

        currentCall.on('close', function() {
            const placeholder = document.getElementById('video-placeholder');
            if (placeholder) placeholder.classList.remove('hidden');

            const camBadge = document.getElementById('cam-badge');
            if (camBadge) { camBadge.textContent = 'OFFLINE'; camBadge.className = 'cam-badge'; }

            document.getElementById('connection-status').textContent = 'Uzildi';
            document.getElementById('connection-status').className   = 'conn-badge disconnected';

            appendLog(now(), 'Video call uzildi.', 'warn');
        });

        currentCall.on('error', function(err) {
            appendLog(now(), 'Video call xatosi: ' + (err.message || err), 'error');
        });

        appendLog(now(), 'Qurilmaga video call yuborildi: ' + targetId.substring(0, 12) + '...', 'info');

    } catch (e) {
        appendLog(now(), 'Video call boshlashda xatolik: ' + e.message, 'error');
    }
}

/**
 * PeerJS uchun bitta silent audio track bo'lgan MediaStream qaytaradi.
 * Bu bo'sh MediaStream emas — PeerJS uchun hech bo'lmasa bitta track kerak.
 */
function createSilentStream() {
    ensureAudioContext();
    const destination = audioCtx.createMediaStreamDestination();
    const oscillator  = audioCtx.createOscillator();
    const gain        = audioCtx.createGain();
    gain.gain.value   = 0; // Ovoz yo'q (silent)
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    return destination.stream;
}

// ============================================================
// ADMIN BOSHQARUV FUNKSIYALARI
// ============================================================

function toggleFlashlight() {
    if (!currentTargetId) { alert('Avval qurilmani tanlang.'); return; }

    isFlashlightOn = !isFlashlightOn;
    db.ref('devices/' + currentTargetId + '/commands/flashlight').set(isFlashlightOn);

    const btn = document.getElementById('flashBtn');
    if (btn) {
        const span = btn.querySelector('span');
        if (span) span.textContent = isFlashlightOn ? 'Fonar o\'chirish' : 'Fonar yoqish';
        btn.classList.toggle('active', isFlashlightOn);
    }
    appendLog(now(), 'Fonar buyrug\'i yuborildi: ' + isFlashlightOn, 'info');
}

async function toggleTalk() {
    if (!currentTargetId) { alert('Avval qurilmani tanlang.'); return; }
    if (!adminPeer || !adminPeer.id) { alert('Admin peer tayyor emas.'); return; }

    const btn = document.getElementById('talkBtn');

    if (!isTalking) {
        try {
            talkStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl:  true
                }
            });

            // Avvalgi talk callni yopish
            if (talkCall) { try { talkCall.close(); } catch(e){} }

            talkCall  = adminPeer.call(currentTargetId, talkStream);
            isTalking = true;

            talkCall.on('error', function(err) {
                appendLog(now(), 'Ovoz call xatosi: ' + (err.message || err), 'error');
            });

            talkCall.on('close', function() {
                isTalking = false;
                if (btn) {
                    const span = btn.querySelector('span');
                    if (span) span.textContent = 'Gapirish';
                    btn.classList.remove('active');
                }
                appendLog(now(), 'Ovoz call tugadi.', 'info');
            });

            if (btn) {
                const span = btn.querySelector('span');
                if (span) span.textContent = 'Gapirilmoqda (to\'xtatish)';
                btn.classList.add('active');
            }
            appendLog(now(), 'Ovoz uzatish boshlandi.', 'info');

        } catch (e) {
            alert('Mikrofon ruxsati berilmadi: ' + e.message);
        }
    } else {
        if (talkStream) {
            talkStream.getTracks().forEach(function(t) { t.stop(); });
            talkStream = null;
        }
        if (talkCall) {
            try { talkCall.close(); } catch(e){}
            talkCall = null;
        }
        isTalking = false;

        if (btn) {
            const span = btn.querySelector('span');
            if (span) span.textContent = 'Gapirish';
            btn.classList.remove('active');
        }
        appendLog(now(), 'Ovoz uzatish to\'xtatildi.', 'info');
    }
}

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

    appendLog(now(), 'Sirena buyrug\'i yuborildi: ' + type + ', ovoz: ' + vol, 'info');
}

function stopAlarmRemote() {
    if (!currentTargetId) { alert('Avval qurilmani tanlang.'); return; }

    db.ref('devices/' + currentTargetId + '/commands/alarm').set({ active: false });
    appendLog(now(), 'Sirenani to\'xtatish buyrug\'i yuborildi.', 'info');
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

        sendLog('Alarm boshlandi: ' + type + ', ovoz: ' + volume, 'info');

    } catch (e) {
        sendLog('Alarm boshlashda xatolik: ' + e.message, 'error');
    }
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

/** Hozirgi vaqt qisqa formati */
function now() {
    return new Date().toLocaleTimeString('uz-UZ');
}
