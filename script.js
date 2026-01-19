import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, collection, getDocs, limit, query, setDoc, getDoc, addDoc, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js";

// Configuração Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDD-CBc_0IeSKiW0Xy3sSjWkHu3j6g-38Q",
    authDomain: "gibiversee.firebaseapp.com",
    projectId: "gibiversee",
    storageBucket: "gibiversee.firebasestorage.app",
    messagingSenderId: "1033170939996",
    appId: "1:1033170939996:web:b3452cf42b16db1fbe3699"
};

// ID FIXO
const appId = "starlight-tv-oficial-v1";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Elementos DOM
const videoElement = document.getElementById('main-video');
const standbyScreen = document.getElementById('standby-screen');
const loginScreen = document.getElementById('login-screen');
const usernameScreen = document.getElementById('username-screen');
const permissionScreen = document.getElementById('permission-screen');
const appContainer = document.getElementById('app-container');

// Estado
let schedule = [];
let currentProgram = null;
let hls = null;
let globalSettings = {};
let currentUserData = null;
let isStarted = false;

// ==========================================
// 1. FLUXO DE AUTENTICAÇÃO
// ==========================================

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loginScreen.classList.add('hidden');
        const userRef = doc(db, 'artifacts', appId, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists() && userSnap.data().username) {
            currentUserData = userSnap.data();
            showPermissionScreen();
        } else {
            usernameScreen.classList.remove('hidden');
        }
    } else {
        loginScreen.classList.remove('hidden');
        loginScreen.classList.remove('opacity-0');
        usernameScreen.classList.add('hidden');
        permissionScreen.classList.add('hidden');
        appContainer.style.opacity = '0';
        isStarted = false;
    }
});

function showPermissionScreen() {
    usernameScreen.classList.add('hidden');
    if (!isStarted) {
        permissionScreen.classList.remove('hidden');
    }
}

document.getElementById('btn-permission-start').addEventListener('click', () => {
    isStarted = true;
    permissionScreen.classList.add('hidden');
    appContainer.style.opacity = '1';
    
    initListeners();
    initChat();
    
    videoElement.play().catch(() => {});
    checkScheduleLoop();
});

document.getElementById('btn-do-login').addEventListener('click', () => {
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    if(!e || !p) return;
    
    toggleLoginLoading(true);
    signInWithEmailAndPassword(auth, e, p).catch(handleAuthError).finally(() => toggleLoginLoading(false));
});

document.getElementById('btn-do-signup').addEventListener('click', () => {
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    if(!e || !p) return;

    toggleLoginLoading(true);
    createUserWithEmailAndPassword(auth, e, p).catch(handleAuthError).finally(() => toggleLoginLoading(false));
});

function handleAuthError(err) {
    const el = document.getElementById('login-error');
    el.classList.remove('hidden');
    if (err.code === 'auth/email-already-in-use') el.innerText = "Email já cadastrado. Faça login.";
    else if (err.code === 'auth/weak-password') el.innerText = "Senha fraca (mínimo 6 dígitos).";
    else if (err.code === 'auth/invalid-credential') el.innerText = "Dados incorretos.";
    else el.innerText = "Erro: " + err.message;
}

function toggleLoginLoading(isLoading) {
    const btn = document.getElementById('btn-do-login');
    btn.innerText = isLoading ? "..." : "CONECTAR";
    btn.disabled = isLoading;
}

document.getElementById('btn-save-username').addEventListener('click', async () => {
    const username = document.getElementById('username-input').value.trim();
    if(username.length < 3) return alert('Nome muito curto!');

    const errorEl = document.getElementById('username-error');
    errorEl.classList.add('hidden');

    try {
        const uid = auth.currentUser.uid;
        await setDoc(doc(db, 'artifacts', appId, 'users', uid), { 
            username: username,
            email: auth.currentUser.email
        }, { merge: true });
        
        currentUserData = { username };
        showPermissionScreen();
    } catch(e) {
        errorEl.innerText = "Erro ao salvar nome.";
        errorEl.classList.remove('hidden');
    }
});

window.logout = () => signOut(auth).then(() => location.reload());

// ==========================================
// 2. SINCRONIZAÇÃO E PLAYER (Core)
// ==========================================

function initListeners() {
    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'schedule'), (snap) => {
        schedule = [];
        snap.forEach(d => schedule.push({id: d.id, ...d.data()}));
        schedule.sort((a,b) => a.time.localeCompare(b.time));
        renderScheduleSidebar();
        checkScheduleLoop();
    });

    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global'), (snap) => {
        const settings = snap.data() || {};
        const maint = document.getElementById('maintenance-screen');
        if(settings.maintenanceMode) {
            maint.classList.remove('hidden');
            document.getElementById('maintenance-message').innerText = settings.maintenanceMessage || "Voltamos já.";
            videoElement.pause();
        } else {
            maint.classList.add('hidden');
        }
    });
}

function checkScheduleLoop() {
    if(!isStarted) return;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    let activeItem = schedule.find(item => item.active === true);

    if (!activeItem) {
        activeItem = schedule.find(item => {
            const [h, m] = item.time.split(':').map(Number);
            const startMinutes = h * 60 + m;
            const endMinutes = startMinutes + parseInt(item.duration);
            return currentMinutes >= startMinutes && currentMinutes < endMinutes;
        });
    }

    if (activeItem) {
        const [h, m] = activeItem.time.split(':').map(Number);
        const programStartTime = new Date();
        programStartTime.setHours(h, m, 0, 0);
        let elapsedSeconds = (now - programStartTime) / 1000;
        playProgram(activeItem, elapsedSeconds);
    } else {
        goStandby();
    }
}

setInterval(checkScheduleLoop, 1000);

function playProgram(item, targetTime) {
    if (!currentProgram || currentProgram.id !== item.id) {
        console.log("Novo Programa Detectado:", item.title);
        currentProgram = item;
        loadStream(item.url, targetTime);
        updateUI(item);
    } else {
        if (videoElement.paused) return;
        const drift = Math.abs(videoElement.currentTime - targetTime);
        if (drift > 4) {
            const syncBadge = document.getElementById('sync-status');
            syncBadge.classList.remove('hidden');
            videoElement.currentTime = targetTime;
            setTimeout(() => syncBadge.classList.add('hidden'), 2000);
        }
    }
}

function goStandby() {
    if(currentProgram === null) return;
    currentProgram = null;
    videoElement.pause();
    standbyScreen.classList.remove('hidden');
    document.getElementById('program-title').innerText = "Aguardando...";
    document.getElementById('program-category').innerText = "OFF AIR";
}

function loadStream(url, startTime) {
    standbyScreen.classList.add('hidden');
    
    let finalUrl = url;
    if (url.includes('api.anivideo.net')) {
        try {
            const u = new URL(url);
            if(u.searchParams.get('d')) finalUrl = u.searchParams.get('d');
        } catch(e){}
    }

    const onReady = () => {
        videoElement.currentTime = startTime;
        videoElement.play().catch(e => {
            console.warn("Autoplay bloqueado.", e);
            videoElement.muted = true;
            videoElement.play();
        });
        updateMuteIcon();
    };

    if (Hls.isSupported() && (finalUrl.includes('.m3u8') || url.includes('.m3u8'))) {
        if (hls) hls.destroy();
        hls = new Hls();
        hls.loadSource(finalUrl);
        hls.attachMedia(videoElement);
        hls.on(Hls.Events.MANIFEST_PARSED, onReady);
    } else {
        videoElement.src = finalUrl;
        videoElement.addEventListener('loadedmetadata', onReady);
    }
}

// ==========================================
// 3. UI & CHAT
// ==========================================

function updateUI(item) {
    document.getElementById('program-title').innerText = item.title;
    // Descrição pode não existir no novo design mobile, mas mantemos update seguro
    // document.getElementById('program-desc').innerText = item.desc || '';
    document.getElementById('program-category').innerText = item.category || 'NO AR';
    // document.getElementById('program-poster').src = item.image || '';
    renderScheduleSidebar();
}

function renderScheduleSidebar() {
    const list = document.getElementById('schedule-list');
    list.innerHTML = '';
    
    if(schedule.length === 0) {
        list.innerHTML = '<div class="text-zinc-500 text-xs text-center p-4">Dados insuficientes.</div>';
        return;
    }

    schedule.forEach(item => {
        const isActive = (currentProgram && currentProgram.id === item.id) || item.active;
        const div = document.createElement('div');
        div.className = `program-item ${isActive ? 'active' : ''}`;
        div.innerHTML = `
            <div class="text-center min-w-[50px]">
                <div class="text-xs font-bold text-white font-mono">${item.time}</div>
                ${isActive ? '<div class="text-[9px] text-cyan-400 font-bold animate-pulse mt-1">ON</div>' : ''}
            </div>
            <img src="${item.image || ''}" class="w-10 h-10 object-cover rounded bg-white/10 grayscale ${isActive ? 'grayscale-0' : ''}">
            <div class="min-w-0 flex-1">
                <div class="text-xs font-bold text-white truncate font-display tracking-wide">${item.title}</div>
                <div class="text-[9px] text-zinc-500 font-mono">${item.category} • ${item.duration}m</div>
            </div>
        `;
        list.appendChild(div);
    });
}

function initChat() {
    const chatRef = collection(db, 'artifacts', appId, 'public', 'data', 'chat');
    const q = query(chatRef, orderBy('timestamp', 'asc'), limit(50));
    
    onSnapshot(q, (snap) => {
        const container = document.getElementById('chat-messages');
        container.innerHTML = ''; 
        let lastMsg = null; 

        snap.forEach(doc => {
            const msg = doc.data();
            const el = document.createElement('div');
            const isMe = auth.currentUser && msg.uid === auth.currentUser.uid;
            
            el.className = `chat-msg ${isMe ? 'mine' : ''}`;
            const timeStr = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';

            el.innerHTML = `
                <div class="flex items-baseline justify-between mb-1 gap-2">
                    <span class="font-bold text-[10px] ${isMe ? 'text-cyan-400' : 'text-zinc-400'} uppercase tracking-wider">${msg.username}</span>
                    <span class="text-[9px] text-zinc-700">${timeStr}</span>
                </div>
                <div class="text-xs text-zinc-300 break-words leading-snug">${msg.text}</div>
            `;
            container.appendChild(el);
            lastMsg = el;
        });
        
        if(lastMsg) lastMsg.scrollIntoView({ behavior: "smooth" });
    });
}

window.sendMessage = async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text || !currentUserData) return;

    input.value = ''; 
    try {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'chat'), {
            text: text,
            username: currentUserData.username,
            uid: auth.currentUser.uid,
            timestamp: serverTimestamp()
        });
    } catch(err) {
        console.error("Erro chat:", err);
    }
};

window.switchSidebarTab = (tab) => {
    document.getElementById('tab-grade').classList.toggle('active', tab === 'grade');
    document.getElementById('tab-chat').classList.toggle('active', tab === 'chat');
    
    if(tab === 'grade') {
        document.getElementById('content-grade').classList.remove('hidden');
        document.getElementById('content-chat').classList.add('hidden');
    } else {
        document.getElementById('content-grade').classList.add('hidden');
        document.getElementById('content-chat').classList.remove('hidden');
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;
    }
};

window.toggleMute = () => {
    videoElement.muted = !videoElement.muted;
    updateMuteIcon();
};

// ==========================================
// FULLSCREEN COM ROTAÇÃO (Fix Mobile)
// ==========================================
window.toggleFullscreen = async () => {
    const wrapper = document.getElementById('video-wrapper');
    const video = document.getElementById('main-video');

    if (!document.fullscreenElement) {
        try {
            if (wrapper.requestFullscreen) {
                await wrapper.requestFullscreen();
            } else if (video.webkitEnterFullscreen) {
                // Suporte iOS nativo
                video.webkitEnterFullscreen();
                return; 
            }

            // Tentar travar a orientação para Landscape (Android/Chrome)
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('landscape').catch(e => {
                    console.log('Orientação automática não suportada:', e);
                });
            }
        } catch (err) {
            console.error("Erro ao entrar em tela cheia:", err);
        }
    } else {
        try {
            await document.exitFullscreen();
            // Destravar orientação ao sair
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        } catch (err) {
            console.error("Erro ao sair da tela cheia:", err);
        }
    }
};

function updateMuteIcon() {
    const icon = document.getElementById('mute-icon');
    if(videoElement.muted) {
        icon.setAttribute('data-lucide', 'volume-x');
        icon.classList.add('text-red-400');
    } else {
        icon.setAttribute('data-lucide', 'volume-2');
        icon.classList.remove('text-red-400');
    }
    lucide.createIcons();
}

setInterval(() => {
    const d = new Date();
    document.getElementById('clock').innerText = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}, 1000);

lucide.createIcons();

let timer;
const controls = document.getElementById('video-controls');
const container = document.getElementById('video-wrapper');
const showControls = () => {
    controls.style.opacity = '1';
    container.style.cursor = 'default';
    clearTimeout(timer);
    timer = setTimeout(() => {
        if(!videoElement.paused) {
            controls.style.opacity = '0';
            container.style.cursor = 'none';
        }
    }, 3000);
};
container.addEventListener('mousemove', showControls);
container.addEventListener('click', showControls);
container.addEventListener('touchstart', showControls);