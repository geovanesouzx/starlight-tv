import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, collection, getDocs, limit, query, setDoc, getDoc, addDoc, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDD-CBc_0IeSKiW0Xy3sSjWkHu3j6g-38Q",
    authDomain: "gibiversee.firebaseapp.com",
    projectId: "gibiversee",
    storageBucket: "gibiversee.firebasestorage.app",
    messagingSenderId: "1033170939996",
    appId: "1:1033170939996:web:b3452cf42b16db1fbe3699"
};

const appId = "starlight-tv-oficial-v1";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Elements
const videoElement = document.getElementById('main-video');
const standbyScreen = document.getElementById('standby-screen');
const loginScreen = document.getElementById('login-screen');
const usernameScreen = document.getElementById('username-screen');
const appContainer = document.getElementById('app-container');

// State
let schedule = [];
let currentProgram = null;
let hls = null;
let globalSettings = {};
let currentUserData = null;

// ==========================================
// 1. FLUXO DE AUTENTICAÇÃO
// ==========================================

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loginScreen.classList.add('opacity-0');
        setTimeout(() => loginScreen.classList.add('hidden'), 500);
        const userRef = doc(db, 'artifacts', appId, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists() && userSnap.data().username) {
            currentUserData = userSnap.data();
            enterApp();
        } else {
            usernameScreen.classList.remove('hidden');
        }
    } else {
        loginScreen.classList.remove('hidden');
        setTimeout(() => loginScreen.classList.remove('opacity-0'), 10);
        appContainer.style.opacity = '0';
    }
});

function enterApp() {
    usernameScreen.classList.add('hidden');
    appContainer.style.opacity = '1';
    initListeners();
    initChat();
    checkScheduleLoop();
}

// ... (Login/Signup/Username handlers remain same) ...
document.getElementById('btn-do-login').addEventListener('click', () => {
    const e = document.getElementById('login-email').value; const p = document.getElementById('login-password').value;
    if(!e || !p) return;
    signInWithEmailAndPassword(auth, e, p).catch(err => {
        document.getElementById('login-error').innerText = "Erro ao entrar.";
        document.getElementById('login-error').classList.remove('hidden');
    });
});
document.getElementById('btn-do-signup').addEventListener('click', () => {
    const e = document.getElementById('login-email').value; const p = document.getElementById('login-password').value;
    if(!e || !p) return;
    createUserWithEmailAndPassword(auth, e, p).catch(err => {
        document.getElementById('login-error').innerText = "Erro ao criar.";
        document.getElementById('login-error').classList.remove('hidden');
    });
});
document.getElementById('btn-save-username').addEventListener('click', async () => {
    const username = document.getElementById('username-input').value.trim();
    if(username.length < 3) return;
    const uid = auth.currentUser.uid;
    await setDoc(doc(db, 'artifacts', appId, 'users', uid), { username: username, email: auth.currentUser.email }, { merge: true });
    currentUserData = { username };
    enterApp();
});
window.logout = () => signOut(auth).then(() => location.reload());

// ... (Chat logic remains same) ...
window.sendMessage = async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text || !currentUserData) return;
    input.value = '';
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'chat'), {
        text: text, username: currentUserData.username, uid: auth.currentUser.uid, timestamp: serverTimestamp()
    });
};

// ... (Tab switching and UI logic remains same) ...
window.switchSidebarTab = (tab) => {
    document.getElementById('tab-grade').classList.toggle('active', tab === 'grade');
    document.getElementById('tab-chat').classList.toggle('active', tab === 'chat');
    if(tab === 'grade') { document.getElementById('content-grade').classList.remove('hidden'); document.getElementById('content-chat').classList.add('hidden'); }
    else { document.getElementById('content-grade').classList.add('hidden'); document.getElementById('content-chat').classList.remove('hidden'); }
};
window.toggleMute = () => { videoElement.muted = !videoElement.muted; updateMuteIcon(); };
window.toggleFullscreen = async () => { /* Fullscreen logic same */ 
    const wrapper = document.getElementById('video-wrapper');
    if (!document.fullscreenElement) wrapper.requestFullscreen(); else document.exitFullscreen();
};

// 2. Data Listeners (TV Logic)
function initListeners() {
    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global'), (snap) => {
        globalSettings = snap.data() || {};
        const maint = document.getElementById('maintenance-screen');
        if(globalSettings.maintenanceMode) {
            maint.classList.remove('hidden');
            document.getElementById('maintenance-message').innerText = globalSettings.maintenanceMessage;
            videoElement.pause();
        } else {
            maint.classList.add('hidden');
        }
    });

    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'schedule'), (snap) => {
        schedule = [];
        snap.forEach(d => schedule.push({id: d.id, ...d.data()}));
        // Sort by HH:MM
        schedule.sort((a,b) => a.time.localeCompare(b.time));
        renderScheduleSidebar();
        checkScheduleLoop();
    });
}

// 3. Auto-DJ Logic (Updated for Days)
function checkScheduleLoop() {
    if(!auth.currentUser) return;
    
    const now = new Date();
    const currentDay = now.getDay(); // 0-6
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    // Filter schedule for TODAY
    const todaysSchedule = schedule.filter(item => parseInt(item.day) === currentDay);

    // 1. Check for Active Item (Manual Override)
    let activeItem = schedule.find(item => item.active === true); // Global override

    // 2. Fallback to Day Schedule
    if (!activeItem) {
        activeItem = todaysSchedule.find(item => {
            const [h, m] = item.time.split(':').map(Number);
            const startMinutes = h * 60 + m;
            const endMinutes = startMinutes + parseInt(item.duration);
            return currentMinutes >= startMinutes && currentMinutes < endMinutes;
        });
    }

    if (activeItem) {
        const [h, m] = activeItem.time.split(':').map(Number);
        const startTime = new Date();
        startTime.setHours(h, m, 0, 0);
        const secondsSinceStart = (now - startTime) / 1000;
        playProgram(activeItem, secondsSinceStart);
    } else {
        goStandby();
    }
}

// ... (Play Program, Standby, Load Stream logic remains same) ...
function playProgram(item, targetTime) {
    if (!currentProgram || currentProgram.id !== item.id) {
        currentProgram = item;
        loadStream(item.url, targetTime);
        updateUI(item);
    } else {
        const drift = Math.abs(videoElement.currentTime - targetTime);
        if (drift > 5) {
            document.getElementById('sync-status').classList.remove('hidden');
            videoElement.currentTime = targetTime;
            setTimeout(() => document.getElementById('sync-status').classList.add('hidden'), 2000);
        }
    }
}

function goStandby() {
    if(currentProgram === null) return;
    currentProgram = null;
    videoElement.pause();
    standbyScreen.classList.remove('hidden');
    document.getElementById('live-indicator').classList.add('hidden');
}

function loadStream(url, startTime) {
    standbyScreen.classList.add('hidden');
    let finalUrl = url;
    if (url.includes('api.anivideo.net')) { try { const u = new URL(url); if(u.searchParams.get('d')) finalUrl = u.searchParams.get('d'); } catch(e){} }
    const onReady = () => { videoElement.currentTime = startTime; videoElement.play().catch(e => { videoElement.muted = true; videoElement.play(); }); updateMuteIcon(); };
    if (Hls.isSupported() && (finalUrl.includes('.m3u8') || url.includes('.m3u8'))) {
        if (hls) hls.destroy(); hls = new Hls(); hls.loadSource(finalUrl); hls.attachMedia(videoElement); hls.on(Hls.Events.MANIFEST_PARSED, onReady);
    } else { videoElement.src = finalUrl; videoElement.addEventListener('loadedmetadata', onReady); }
}

function updateUI(item) {
    document.getElementById('program-title').innerText = item.title;
    document.getElementById('program-desc').innerText = item.desc || 'Sem descrição.';
    document.getElementById('program-category').innerText = item.category || 'PROGRAMA';
    document.getElementById('program-poster').src = item.image || '';
    document.getElementById('live-indicator').classList.remove('hidden');
    renderScheduleSidebar();
}

function renderScheduleSidebar() {
    const list = document.getElementById('schedule-list');
    list.innerHTML = '';
    const now = new Date();
    const currentDay = now.getDay();
    
    // Only show today's schedule
    const todaysItems = schedule.filter(i => parseInt(i.day) === currentDay);

    if(todaysItems.length === 0) {
        list.innerHTML = '<div class="text-zinc-500 text-xs text-center p-4">Grade vazia hoje.</div>';
        return;
    }

    todaysItems.forEach(item => {
        const isActive = (currentProgram && currentProgram.id === item.id);
        const el = document.createElement('div');
        el.className = `flex items-center gap-3 p-3 rounded-xl transition-all ${isActive ? 'active-program bg-white/5' : 'hover:bg-white/5 opacity-60 hover:opacity-100'}`;
        el.innerHTML = `
            <div class="text-center min-w-[50px]">
                <div class="text-sm font-bold text-white font-mono">${item.time}</div>
                ${isActive ? '<div class="text-[10px] text-violet-400 font-bold animate-pulse">NO AR</div>' : ''}
            </div>
            <img src="${item.image || ''}" class="w-12 h-16 object-cover rounded bg-black">
            <div class="min-w-0">
                <div class="text-sm font-bold text-white truncate">${item.title}</div>
                <div class="text-[10px] text-zinc-400">${item.category} • ${item.duration}m</div>
            </div>
        `;
        list.appendChild(el);
    });
}

// ... (Chat init and Utils same) ...
function initChat() {
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'chat'), orderBy('timestamp', 'asc'), limit(50));
    onSnapshot(q, (snap) => {
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        snap.forEach(doc => {
            const msg = doc.data();
            const el = document.createElement('div');
            el.className = `chat-msg ${auth.currentUser && msg.uid === auth.currentUser.uid ? 'mine' : ''}`;
            el.innerHTML = `<div class="flex items-baseline justify-between mb-1"><span class="font-bold text-xs ${auth.currentUser && msg.uid === auth.currentUser.uid ? 'text-violet-400' : 'text-zinc-400'}">${msg.username}</span></div><div class="text-sm text-zinc-200 break-words">${msg.text}</div>`;
            container.appendChild(el);
        });
        container.scrollTop = container.scrollHeight;
    });
}

function updateMuteIcon() {
    const icon = document.getElementById('mute-icon');
    if(videoElement.muted) { icon.setAttribute('data-lucide', 'volume-x'); icon.classList.add('text-red-400'); }
    else { icon.setAttribute('data-lucide', 'volume-2'); icon.classList.remove('text-red-400'); }
    lucide.createIcons();
}

videoElement.addEventListener('timeupdate', () => {
    if(currentProgram) {
        const [h, m] = currentProgram.time.split(':').map(Number);
        const startTime = new Date(); startTime.setHours(h, m, 0, 0);
        const elapsed = (new Date() - startTime) / 1000;
        const total = currentProgram.duration * 60;
        const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
        document.getElementById('progress-bar').style.width = `${pct}%`;
    }
});

setInterval(() => {
    const d = new Date();
    document.getElementById('clock').innerText = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}, 1000);

lucide.createIcons();
let timer;
const controls = document.getElementById('video-controls');
const container = document.getElementById('video-wrapper');
container.addEventListener('mousemove', () => {
    controls.style.opacity = '1'; container.style.cursor = 'default';
    clearTimeout(timer);
    timer = setTimeout(() => { if(!videoElement.paused) { controls.style.opacity = '0'; container.style.cursor = 'none'; } }, 3000);
});