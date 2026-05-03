// 1. FIREBASE KONFIGURATSIYASI
const firebaseConfig = {
    apiKey: "AIzaSyBhzWWFFgrOH84J2RIW5o7l_8192iPtbOg",
    authDomain: "code-vibe-df610.firebaseapp.com",
    projectId: "code-vibe-df610",
    storageBucket: "code-vibe-df610.firebasestorage.app",
    messagingSenderId: "747762490655",
    appId: "1:747762490655:web:125516814620784cf3a42a",
    measurementId: "G-3QE6F8LWZ1",
    databaseURL: "https://code-vibe-df610-default-rtdb.firebaseio.com"
};

// 2. GLOBAL O'ZGARUVCHILAR
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const adminPass = "7777";

let peer = null;        // User (Kamera) uchun Peer
let adminPeer = null;   // Admin (Monitoring) uchun Peer
let localStream = null; // Kameradan kelayotgan oqim
let adminMicStream = null;
let isTalking = false;
let currentActiveCallId = null;

// 3. BRAUZER "ORQAGA" TUGMASINI BLOKLASH
window.history.pushState(null, null, window.location.href);
window.onpopstate = function () {
    window.history.pushState(null, null, window.location.href);
};

// 4. SAHIFA YUKLANGANDA HOLATNI TEKSHIRISH
window.onload = () => {
    const savedRole = localStorage.getItem('myRTC_role');
    const savedName = localStorage.getItem('myRTC_deviceName');

    if (savedRole === 'user' && savedName) {
        startUserLogic(savedName);
    } else if (savedRole === 'admin') {
        openAdmin(true); // Parolsiz qayta kirish
    }
};

// 5. ASOSIY NAVIGATSIYA FUNKSIYASI
function goHome() {
    if (confirm("Haqiqatan ham bosh sahifaga qaytmoqchimisiz?")) {
        localStorage.removeItem('myRTC_role');
        localStorage.removeItem('myRTC_deviceName');
        window.location.reload();
    }
}

// --- USER MODE (Uydagi telefon) ---
async function openUser() {
    const name = prompt("Qurilma nomi (masalan: Samsung A13):");
    if (!name) return;

    localStorage.setItem('myRTC_role', 'user');
    localStorage.setItem('myRTC_deviceName', name);

    startUserLogic(name);
}

async function startUserLogic(deviceName) {
    document.getElementById('main-ui').style.display = 'none';
    document.body.style.background = "white"; // To'liq oq ekran

    peer = new Peer();

    peer.on('open', (id) => {
        db.ref('devices/' + id).set({
            name: deviceName,
            status: 'online',
            lastSeen: Date.now()
        });

        db.ref('devices/' + id).onDisconnect().remove();

        // GPS Kuzatuv
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition(pos => {
                db.ref('devices/' + id + '/location').set({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    time: new Date().toLocaleTimeString()
                });
            }, null, { enableHighAccuracy: true });
        }
    });

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" }, 
            audio: true 
        });

        peer.on('call', (call) => {
            call.answer(localStream);
            call.on('stream', (remoteStream) => {
                const audio = new Audio();
                audio.srcObject = remoteStream;
                audio.play();
            });
        });

        peer.on('disconnected', () => setTimeout(() => location.reload(), 3000));
        
        // Ekranni tozalash (faqat yashirin qaytish tugmasi qoladi)
        document.getElementById('main-ui').style.display = 'none';
        const backdoor = document.createElement('div');
        backdoor.style.position = "fixed";
        backdoor.style.top = "0";
        backdoor.style.left = "0";
        backdoor.style.width = "50px";
        backdoor.style.height = "50px";
        backdoor.style.zIndex = "10000";
        backdoor.onclick = goHome;
        document.body.appendChild(backdoor);

    } catch (e) {
        setTimeout(() => location.reload(), 5000);
    }
}

// --- ADMIN MODE (Monitoring) ---
function openAdmin(isAuto = false) {
    if (!isAuto) {
        const pass = prompt("Parol:");
        if (pass !== adminPass) return alert("Xato!");
    }

    localStorage.setItem('myRTC_role', 'admin');
    document.getElementById('main-ui').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    document.getElementById('top-nav').style.display = 'flex';

    if (!adminPeer) adminPeer = new Peer();

    db.ref('devices').on('value', (snapshot) => {
        const listDiv = document.getElementById('device-list');
        listDiv.innerHTML = "";
        const data = snapshot.val();

        if (data) {
            for (let id in data) {
                const btn = document.createElement('button');
                btn.innerText = "ULANISH: " + data[id].name;
                btn.onclick = () => connectToDevice(id, data[id].name);
                listDiv.appendChild(btn);
            }
        }
    });
}

function connectToDevice(deviceId, name) {
    currentActiveCallId = deviceId;
    document.getElementById('target-name').innerText = "Qurilma: " + name;

    db.ref('devices/' + deviceId + '/location').on('value', (snap) => {
        const loc = snap.val();
        if (loc) {
            document.getElementById('location-display').innerText = 
                `Kordinata: ${loc.lat}, ${loc.lng} (Vaqt: ${loc.time})`;
        }
    });

    const call = adminPeer.call(deviceId, null);
    
    call.on('stream', (remoteStream) => {
        const video = document.getElementById('remoteVideo');
        video.srcObject = remoteStream;
        
        const slider = document.getElementById('volumeSlider');
        slider.oninput = () => { video.volume = slider.value; };
    });
}

// --- ADMIN GAPIRISHI ---
async function toggleTalk() {
    const btn = document.getElementById('talkBtn');
    if (!currentActiveCallId) return alert("Avval qurilmani tanlang!");

    if (!isTalking) {
        try {
            adminMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            adminPeer.call(currentActiveCallId, adminMicStream);
            
            isTalking = true;
            btn.innerText = "GAPIRILMOQDA... (STOP)";
            btn.style.background = "#dc3545";
        } catch (e) {
            alert("Mikrofon ruxsati berilmadi!");
        }
    } else {
        if (adminMicStream) {
            adminMicStream.getTracks().forEach(track => track.stop());
        }
        isTalking = false;
        btn.innerText = "GAPIRISH (Yopiq)";
        btn.style.background = "#28a745";
    }
}
