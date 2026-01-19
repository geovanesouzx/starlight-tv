import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, collection, query, addDoc, orderBy, serverTimestamp, getDoc, setDoc, limit } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
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

const appId = "starlight-tv-oficial-v1";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const videoElement = document.getElementById('main-video');
const standbyScreen = document.getElementById('standby-screen');
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');

// State
let schedule = [];
let currentProgram = null;
let hls = null;
let currentUserData = null;
let isVideoFitCover = true; // Controle de Zoom

// ==========================================
// 1. AUTENTICAÇÃO
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Se já logado
        const userRef = doc(db, 'artifacts', appId, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists() && userSnap.data().username) {
            currentUserData = userSnap.data();
            loginScreen.classList.add('hidden');
            appContainer.style.opacity = '1';
            
            initSystem();
        } else {
            document.getElementById('username-screen').classList.remove('hidden');
            loginScreen.classList.add('hidden');
        }
    } else {
        loginScreen.classList.remove('hidden');
        appContainer.style.opacity = '0';
    }
});

// Botões de Login
document.getElementById('btn-do-login').addEventListener('click', () => {
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    if(!e || !p) return;
    
    signInWithEmailAndPassword(auth, e, p).catch(err => {
        const el = document.getElementById('login-error');
        el.innerText = "Erro ao entrar: " + err.message;
        el.classList.remove('hidden');
    });
});

document.getElementById('btn-save-username').addEventListener('click', async () => {
    const username = document.getElementById('username-input').value.trim();
    if(username.length < 3) return;
    
    const uid = auth.currentUser.uid;
    await setDoc(doc(db, 'artifacts', appId, 'users', uid), { 
        username: username,
        email: auth.currentUser.email
    }, { merge: true });
    
    document.getElementById('username-screen').classList.add('hidden');
    appContainer.style.opacity = '1';
    currentUserData = { username };
    initSystem();
});

window.logout = () => signOut(auth).then(() => location.reload());

// ==========================================
// 2. SISTEMA DE TV (AUTO-DJ)
// ==========================================
function initSystem() {
    initScheduleListener();
    initChat();
    
    // Loop de Verificação Crítico (Roda a cada 1 segundo)
    // Garante que o programa troque automaticamente
    setInterval(checkScheduleLoop, 1000);
}

function initScheduleListener() {
    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'schedule'), (snap) => {
        schedule = [];
        const today = new Date().getDay(); // 0 = Domingo
        
        snap.forEach(d => {
            const data = d.data();
            // Filtra programas do dia atual
            if (data.day === undefined || parseInt(data.day) === today) {
                schedule.push({id: d.id, ...data});
            }
        });
        
        // Ordena por horário
        schedule.sort((a,b) => a.time.localeCompare(b.time));
        renderScheduleSidebar();
        checkScheduleLoop(); // Checa imediatamente ao receber dados
    });
}

// A Lógica do Cérebro da TV
function checkScheduleLoop() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    // 1. Procura item forçado manualmente como "active"
    let activeItem = schedule.find(item => item.active === true);

    // 2. Se não houver manual, procura pelo horário
    if (!activeItem) {
        activeItem = schedule.find(item => {
            const [h, m] = item.time.split(':').map(Number);
            const startMinutes = h * 60 + m;
            const duration = parseInt(item.duration) || 30; // default 30 min se não especificado
            const endMinutes = startMinutes + duration;
            
            return currentMinutes >= startMinutes && currentMinutes < endMinutes;
        });
    }

    if (activeItem) {
        const [h, m] = activeItem.time.split(':').map(Number);
        const startTime = new Date();
        startTime.setHours(h, m, 0, 0);
        
        // Calcula tempo decorrido em segundos para sincronizar o vídeo
        const secondsSinceStart = (now - startTime) / 1000;
        
        playProgram(activeItem, secondsSinceStart);
    } else {
        goStandby();
    }
}

function playProgram(item, targetTime) {
    // Se mudou o programa (ID diferente)
    if (!currentProgram || currentProgram.id !== item.id) {
        console.log("Mudando programa para:", item.title);
        currentProgram = item;
        
        // Atualiza UI
        document.getElementById('program-title').innerText = item.title;
        document.getElementById('program-desc').innerText = item.desc || '';
        document.getElementById('program-category').innerText = item.category || 'NO AR';
        
        loadStream(item.url, targetTime);
        renderScheduleSidebar();
    } else {
        // Se é o mesmo programa, apenas verifica drift (desalinhamento de tempo)
        // Só sincroniza se a diferença for maior que 8 segundos para evitar "pulos" constantes
        const drift = Math.abs(videoElement.currentTime - targetTime);
        if (drift > 8 && item.duration > 0 && !videoElement.paused) {
            console.log("Ressincronizando...");
            const syncBadge = document.getElementById('sync-status');
            syncBadge.classList.remove('hidden');
            videoElement.currentTime = targetTime;
            setTimeout(() => syncBadge.classList.add('hidden'), 2000);
        }
    }
}

function loadStream(url, startTime) {
    standbyScreen.classList.add('hidden');
    
    // Suporte para API Anivideo (extrai link direto se necessário)
    let finalUrl = url;
    if (url.includes('api.anivideo.net') && url.includes('?d=')) {
        try { finalUrl = new URL(url).searchParams.get('d'); } catch(e){}
    }

    const startConfig = () => {
        videoElement.currentTime = startTime;
        // Tenta dar play. Se o navegador bloquear (user gesture required), 
        // o usuário precisará clicar no unmute depois.
        videoElement.play().then(() => {
            updateMuteIcon();
        }).catch(e => {
            console.warn("Autoplay bloqueado pelo navegador. Vídeo mudo iniciado.");
            videoElement.muted = true;
            videoElement.play();
            updateMuteIcon();
        });
    };

    if (Hls.isSupported() && (finalUrl.includes('.m3u8') || finalUrl.includes('m3u8'))) {
        if (hls) hls.destroy();
        hls = new Hls();
        hls.loadSource(finalUrl);
        hls.attachMedia(videoElement);
        hls.on(Hls.Events.MANIFEST_PARSED, startConfig);
    } else {
        videoElement.src = finalUrl;
        videoElement.addEventListener('loadedmetadata', startConfig, {once: true});
    }
}

function goStandby() {
    if (currentProgram === null) return; // Já está em standby
    currentProgram = null;
    videoElement.pause();
    standbyScreen.classList.remove('hidden');
    document.getElementById('program-title').innerText = "...";
}

// ==========================================
// 3. UI, CHAT & UTILS
// ==========================================

// Chat
function initChat() {
    const chatRef = collection(db, 'artifacts', appId, 'public', 'data', 'chat');
    const q = query(chatRef, orderBy('timestamp', 'asc'), limit(50));
    
    onSnapshot(q, (snap) => {
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        snap.forEach(d => {
            const msg = d.data();
            const isMe = msg.uid === auth.currentUser.uid;
            
            const div = document.createElement('div');
            div.className = `chat-msg ${isMe ? 'mine' : ''} flex flex-col`;
            div.innerHTML = `
                <div class="flex justify-between items-baseline mb-1">
                    <span class="text-[10px] font-bold uppercase tracking-wide username-label ${isMe ? 'text-white' : 'text-violet-400'}">${msg.username}</span>
                </div>
                <div class="leading-snug break-words">${msg.text}</div>
            `;
            container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
    });
}

window.sendMessage = async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !currentUserData) return;
    
    input.value = '';
    
    // Foca de volta no input (exceto mobile pra não subir teclado toda hora)
    if(window.innerWidth > 768) input.focus();

    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'chat'), {
        text,
        username: currentUserData.username,
        uid: auth.currentUser.uid,
        timestamp: serverTimestamp()
    });
};

// Sidebar Rendering
function renderScheduleSidebar() {
    const list = document.getElementById('schedule-list');
    list.innerHTML = '';
    
    // Atualiza nome do dia
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    document.getElementById('schedule-day-label').innerText = days[new Date().getDay()];

    schedule.forEach(item => {
        const isActive = currentProgram && currentProgram.id === item.id;
        const div = document.createElement('div');
        div.className = `flex items-center gap-3 p-3 rounded-lg transition-all ${isActive ? 'active-program bg-white/5' : 'hover:bg-white/5 opacity-50 hover:opacity-100'}`;
        div.innerHTML = `
            <div class="text-center w-12 shrink-0">
                <div class="text-sm font-bold text-white font-mono">${item.time}</div>
                ${isActive ? '<div class="text-[9px] text-violet-400 font-bold animate-pulse">NO AR</div>' : ''}
            </div>
            <div class="min-w-0">
                <div class="text-sm font-bold text-white truncate">${item.title}</div>
                <div class="text-[10px] text-zinc-400 truncate">${item.category || 'Programa'}</div>
            </div>
        `;
        list.appendChild(div);
    });
}

// Player Controls
window.toggleMute = () => {
    videoElement.muted = !videoElement.muted;
    updateMuteIcon();
};

window.toggleZoom = () => {
    isVideoFitCover = !isVideoFitCover;
    if (isVideoFitCover) {
        videoElement.classList.add('video-cover');
        videoElement.classList.remove('video-contain');
        document.getElementById('zoom-icon').setAttribute('data-lucide', 'rectangle-horizontal'); // Ícone cheio
    } else {
        videoElement.classList.add('video-contain');
        videoElement.classList.remove('video-cover');
        document.getElementById('zoom-icon').setAttribute('data-lucide', 'minimize'); // Ícone menor
    }
    lucide.createIcons();
};

window.toggleFullscreen = () => {
    const wrapper = document.getElementById('video-wrapper');
    if (!document.fullscreenElement) {
        wrapper.requestFullscreen().catch(err => console.log(err));
    } else {
        document.exitFullscreen();
    }
};

window.switchSidebarTab = (tab) => {
    const chatBtn = document.getElementById('tab-chat');
    const gradeBtn = document.getElementById('tab-grade');
    const chatContent = document.getElementById('content-chat');
    const gradeContent = document.getElementById('content-grade');

    if (tab === 'chat') {
        chatBtn.classList.add('active');
        gradeBtn.classList.remove('active');
        chatContent.classList.remove('hidden');
        gradeContent.classList.add('hidden');
        // Scroll p/ baixo
        const msgs = document.getElementById('chat-messages');
        msgs.scrollTop = msgs.scrollHeight;
    } else {
        gradeBtn.classList.add('active');
        chatBtn.classList.remove('active');
        gradeContent.classList.remove('hidden');
        chatContent.classList.add('hidden');
    }
};

function updateMuteIcon() {
    const icon = document.getElementById('mute-icon');
    if (videoElement.muted) {
        icon.setAttribute('data-lucide', 'volume-x');
        icon.classList.add('text-red-400');
    } else {
        icon.setAttribute('data-lucide', 'volume-2');
        icon.classList.remove('text-red-400');
    }
    lucide.createIcons();
}

// Clock
setInterval(() => {
    const d = new Date();
    document.getElementById('clock').innerText = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}, 1000);

// Init Icons
lucide.createIcons();