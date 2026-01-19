import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, collection, getDocs, limit, query, setDoc, getDoc, addDoc, orderBy, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
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

// Elementos DOM
const videoElement = document.getElementById('main-video');
const standbyScreen = document.getElementById('standby-screen');
const loginScreen = document.getElementById('login-screen');
const usernameScreen = document.getElementById('username-screen');
const appContainer = document.getElementById('app-container');

// Estado
let schedule = [];
let currentProgram = null;
let hls = null;
let globalSettings = {};
let currentUserData = null;

// ==========================================
// 1. FLUXO DE AUTENTICAÇÃO E AUDIO FIX
// ==========================================

// Função crítica: Desbloqueia o áudio aproveitando o clique do usuário
function unlockAudio() {
    videoElement.muted = false;
    updateMuteIcon();
    // Tenta iniciar um contexto de áudio ou tocar vazio para garantir permissão
    videoElement.play().catch(() => {});
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Usuário logado
        loginScreen.classList.add('opacity-0');
        setTimeout(() => loginScreen.classList.add('hidden'), 500);

        const userRef = doc(db, 'artifacts', appId, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists() && userSnap.data().username) {
            currentUserData = userSnap.data();
            enterApp(true); // Flag true = já estava logado (refresh da página)
        } else {
            usernameScreen.classList.remove('hidden');
        }
    } else {
        loginScreen.classList.remove('hidden');
        setTimeout(() => loginScreen.classList.remove('opacity-0'), 10);
        appContainer.style.opacity = '0';
    }
});

// Entrar no app
function enterApp(isAutoLogin = false) {
    usernameScreen.classList.add('hidden');
    appContainer.style.opacity = '1';
    
    // Se NÃO for login automático (foi interação manual agora), desbloqueia o áudio
    if (!isAutoLogin) {
        unlockAudio();
    }
    
    initListeners();
    initChat();
    checkScheduleLoop();
}

// Login Actions - Unmute ao clicar
document.getElementById('btn-do-login').addEventListener('click', () => {
    unlockAudio(); // Critical for autoplay policy
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    if(!e || !p) return;
    
    document.getElementById('login-error').classList.add('hidden');
    
    signInWithEmailAndPassword(auth, e, p).then(() => {
        enterApp(false);
    }).catch(err => {
        const el = document.getElementById('login-error');
        if(err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
            el.innerText = "Email ou senha incorretos.";
        } else {
            el.innerText = "Erro ao entrar: " + err.message;
        }
        el.classList.remove('hidden');
    });
});

document.getElementById('btn-do-signup').addEventListener('click', () => {
    unlockAudio();
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    if(!e || !p) return;

    document.getElementById('login-error').classList.add('hidden');

    createUserWithEmailAndPassword(auth, e, p).then(() => {
        enterApp(false);
    }).catch(err => {
        const el = document.getElementById('login-error');
        if (err.code === 'auth/email-already-in-use') {
            el.innerText = "Este email já possui conta. Tente fazer login.";
        } else if (err.code === 'auth/weak-password') {
            el.innerText = "A senha deve ter pelo menos 6 caracteres.";
        } else if (err.code === 'auth/invalid-email') {
            el.innerText = "Email inválido.";
        } else {
            el.innerText = "Erro ao criar: " + err.message;
        }
        el.classList.remove('hidden');
    });
});

document.getElementById('btn-save-username').addEventListener('click', async () => {
    unlockAudio();
    const username = document.getElementById('username-input').value.trim();
    if(username.length < 3) return alert('Nome muito curto!');

    const errorEl = document.getElementById('username-error');
    errorEl.classList.add('hidden');

    const usernameRef = doc(db, 'artifacts', appId, 'usernames', username.toLowerCase());
    const usernameSnap = await getDoc(usernameRef);

    if(usernameSnap.exists()) {
        errorEl.innerText = "Este nome de usuário já está em uso.";
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const uid = auth.currentUser.uid;
        await setDoc(usernameRef, { uid: uid });
        await setDoc(doc(db, 'artifacts', appId, 'users', uid), { 
            username: username,
            email: auth.currentUser.email
        }, { merge: true });
        
        currentUserData = { username };
        enterApp(false);
    } catch(e) {
        console.error(e);
        errorEl.innerText = "Erro ao salvar. Tente outro.";
        errorEl.classList.remove('hidden');
    }
});

// Funções Globais
window.logout = () => signOut(auth).then(() => location.reload());

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
    } catch(e) {
        console.error("Erro ao enviar msg:", e);
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

window.toggleFullscreen = async () => {
    const wrapper = document.getElementById('video-wrapper');
    const video = document.getElementById('main-video');

    if (!document.fullscreenElement) {
        try {
            if (wrapper.requestFullscreen) {
                await wrapper.requestFullscreen();
            } else if (video.webkitEnterFullscreen) {
                video.webkitEnterFullscreen();
                return; 
            }
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('landscape').catch(e => {
                    console.log('Orientação automática não suportada ou bloqueada pelo navegador:', e);
                });
            }
        } catch (err) {
            console.error("Erro ao entrar em tela cheia:", err);
        }
    } else {
        try {
            await document.exitFullscreen();
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        } catch (err) {
            console.error("Erro ao sair da tela cheia:", err);
        }
    }
};

// 2. Data Listeners (TV Logic)
function initListeners() {
    // Sincronização imediata forçada pelo admin (Live Override)
    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'stream', 'live'), (snap) => {
        const data = snap.data();
        if(data && data.isLive) {
            // Se o timestamp for muito recente (menos de 5s), força play
            const now = Date.now();
            if (now - data.startTime < 5000) {
                 playProgram({
                     id: 'live_override',
                     title: data.title,
                     desc: data.desc,
                     url: data.url,
                     image: data.image,
                     category: 'AO VIVO',
                     duration: 0
                 }, 0);
            }
        }
    });

    // Global Settings
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

    // Schedule Data (Filtrando dia da semana para o Viewer)
    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'schedule'), (snap) => {
        schedule = [];
        const today = new Date().getDay(); // 0 = Dom, 1 = Seg
        
        snap.forEach(d => {
            const data = d.data();
            // Se não tiver dia definido, assume hoje (legado) OU se for o dia de hoje
            if (data.day === undefined || parseInt(data.day) === today) {
                schedule.push({id: d.id, ...data});
            }
        });
        
        schedule.sort((a,b) => a.time.localeCompare(b.time));
        renderScheduleSidebar();
        checkScheduleLoop();
    });
}

// 3. Auto-DJ Logic (The Brain)
function checkScheduleLoop() {
    if(!auth.currentUser) return;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    // PRIORIDADE 1: Item marcado como ATIVO manualmente (Botão "No Ar" do Admin)
    let activeItem = schedule.find(item => item.active === true);

    // PRIORIDADE 2: Item baseado no horário (Fallback Automático)
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
        const startTime = new Date();
        startTime.setHours(h, m, 0, 0);
        
        const secondsSinceStart = (now - startTime) / 1000;

        playProgram(activeItem, secondsSinceStart);
    } else {
        goStandby();
    }
}

// 4. Player Logic
function playProgram(item, targetTime) {
    if (!currentProgram || currentProgram.id !== item.id) {
        console.log("Switching to:", item.title);
        currentProgram = item;
        loadStream(item.url, targetTime);
        updateUI(item);
    } else {
        const drift = Math.abs(videoElement.currentTime - targetTime);
        // Não sincronizar agressivamente se for stream infinito (duration 0)
        if (drift > 5 && item.duration > 0) { 
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
    document.getElementById('live-indicator').classList.add('hidden');
    document.getElementById('program-title').innerText = "Aguardando...";
    document.getElementById('program-desc').innerText = "Fique ligado na programação.";
    document.getElementById('program-category').innerText = "OFF AIR";
}

function loadStream(url, startTime) {
    standbyScreen.classList.add('hidden');
    let finalUrl = url;
    
    // Suporte a API Anivideo
    if (url.includes('api.anivideo.net')) {
        try {
            const u = new URL(url);
            if(u.searchParams.get('d')) finalUrl = u.searchParams.get('d');
        } catch(e){}
    }

    const onReady = () => {
        videoElement.currentTime = startTime;
        // Tentativa agressiva de tocar com som se desbloqueado
        videoElement.play().then(() => {
            updateMuteIcon();
        }).catch(e => {
            console.warn("Autoplay bloqueado. Mutando.", e);
            videoElement.muted = true;
            videoElement.play();
        });
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

// 5. UI Updates
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
    
    // Atualiza o Label do dia da semana
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const today = new Date().getDay();
    document.getElementById('schedule-day-label').innerText = days[today].toUpperCase();

    if(schedule.length === 0) {
        list.innerHTML = '<div class="text-zinc-500 text-xs text-center p-4">Grade vazia para hoje.</div>';
        return;
    }

    schedule.forEach(item => {
        const isActive = (currentProgram && currentProgram.id === item.id) || item.active;
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

// 6. CHAT LOGIC
function initChat() {
    const chatRef = collection(db, 'artifacts', appId, 'public', 'data', 'chat');
    const q = query(chatRef, orderBy('timestamp', 'asc'), limit(50));
    
    onSnapshot(q, (snap) => {
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        snap.forEach(doc => {
            const msg = doc.data();
            const el = document.createElement('div');
            const isMe = msg.uid === auth.currentUser.uid;
            
            el.className = `chat-msg ${isMe ? 'mine' : ''}`;
            el.innerHTML = `
                <div class="flex items-baseline justify-between mb-1">
                    <span class="font-bold text-xs ${isMe ? 'text-violet-400' : 'text-zinc-400'}">${msg.username}</span>
                    <span class="text-[10px] text-zinc-600">${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}</span>
                </div>
                <div class="text-sm text-zinc-200 break-words">${msg.text}</div>
            `;
            container.appendChild(el);
        });
        container.scrollTop = container.scrollHeight;
    });
}

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

videoElement.addEventListener('timeupdate', () => {
    if(currentProgram) {
        const [h, m] = currentProgram.time.split(':').map(Number);
        const startTime = new Date(); 
        startTime.setHours(h, m, 0, 0);
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
    controls.style.opacity = '1';
    container.style.cursor = 'default';
    clearTimeout(timer);
    timer = setTimeout(() => {
        if(!videoElement.paused) {
            controls.style.opacity = '0';
            container.style.cursor = 'none';
        }
    }, 3000);
});