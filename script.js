import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, collection, getDocs, limit, query, setDoc, getDoc, addDoc, orderBy, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
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
let checkInterval = null;

// ==========================================
// 1. FLUXO DE AUTENTICAÇÃO E AUDIO FIX
// ==========================================

function unlockAudio() {
    videoElement.muted = false;
    updateMuteIcon();
    videoElement.play().catch(() => {});
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loginScreen.classList.add('opacity-0');
        setTimeout(() => loginScreen.classList.add('hidden'), 500);

        const userRef = doc(db, 'artifacts', appId, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists() && userSnap.data().username) {
            currentUserData = userSnap.data();
            enterApp(true);
        } else {
            usernameScreen.classList.remove('hidden');
        }
    } else {
        loginScreen.classList.remove('hidden');
        setTimeout(() => loginScreen.classList.remove('opacity-0'), 10);
        appContainer.style.opacity = '0';
        if(checkInterval) clearInterval(checkInterval);
    }
});

function enterApp(isAutoLogin = false) {
    usernameScreen.classList.add('hidden');
    appContainer.style.opacity = '1';
    
    if (!isAutoLogin) unlockAudio();
    
    initListeners();
    initChat();
    
    // INICIA O LOOP DE SINCRONIZAÇÃO AUTOMÁTICA
    checkScheduleLoop();
    if(checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(checkScheduleLoop, 5000); // Checa a cada 5s
}

// Botões de Login
document.getElementById('btn-do-login').addEventListener('click', () => {
    unlockAudio();
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    if(!e || !p) return;
    
    document.getElementById('login-error').classList.add('hidden');
    
    signInWithEmailAndPassword(auth, e, p).then(() => {
        enterApp(false);
    }).catch(err => {
        const el = document.getElementById('login-error');
        el.innerText = "Email ou senha incorretos.";
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
        el.innerText = "Erro ao criar: " + err.message;
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
        errorEl.innerText = "Erro ao salvar.";
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
    // Foco no mobile atrapalha, melhor tirar se estiver enviando
    // input.focus(); 
    
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
                await screen.orientation.lock('landscape').catch(() => {});
            }
        } catch (err) {}
    } else {
        try {
            await document.exitFullscreen();
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        } catch (err) {}
    }
};

// 2. Data Listeners (TV Logic)
function initListeners() {
    // Sincronização imediata forçada pelo admin (Live Override)
    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'stream', 'live'), (snap) => {
        const data = snap.data();
        if(data && data.isLive) {
            const now = Date.now();
            // Se o comando for novo (< 10s), troca imediatamente
            if (now - data.startTime < 10000) {
                 playProgram({
                     id: 'live_override_' + data.startTime, // ID único para forçar troca
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
        const today = new Date().getDay(); 
        
        snap.forEach(d => {
            const data = d.data();
            // Carrega apenas a grade de HOJE
            if (data.day === undefined || parseInt(data.day) === today) {
                schedule.push({id: d.id, ...data});
            }
        });
        
        schedule.sort((a,b) => a.time.localeCompare(b.time));
        renderScheduleSidebar();
        checkScheduleLoop(); // Checa imediatamente ao carregar
    });
}

// 3. Auto-DJ Logic (Sincronização Auto)
function checkScheduleLoop() {
    if(!auth.currentUser) return;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    // 1. Prioridade: Admin forçou "NO AR" na grade
    let activeItem = schedule.find(item => item.active === true);

    // 2. Prioridade: Horário
    if (!activeItem) {
        activeItem = schedule.find(item => {
            const [h, m] = item.time.split(':').map(Number);
            const startMinutes = h * 60 + m;
            const endMinutes = startMinutes + parseInt(item.duration);
            
            // Lógica simples para lidar com virada de dia (ex: começa 23:00, dura 120min)
            // Se endMinutes > 1440 (24h), o vídeo "acaba amanhã", mas ainda está tocando
            // Simplificação: apenas checa se estamos dentro da janela inicial
            return currentMinutes >= startMinutes && currentMinutes < endMinutes;
        });
    }

    if (activeItem) {
        const [h, m] = activeItem.time.split(':').map(Number);
        const startTime = new Date();
        startTime.setHours(h, m, 0, 0);
        
        // Calcula onde o vídeo deve estar
        const secondsSinceStart = (now - startTime) / 1000;

        playProgram(activeItem, secondsSinceStart);
    } else {
        goStandby();
    }
}

// 4. Player Logic
function playProgram(item, targetTime) {
    // Se o programa mudou, carrega o novo
    if (!currentProgram || currentProgram.id !== item.id) {
        console.log("Trocando programa para:", item.title);
        currentProgram = item;
        loadStream(item.url, targetTime);
        updateUI(item);
    } else {
        // Se é o mesmo programa, apenas sincroniza se desviar muito
        const drift = Math.abs(videoElement.currentTime - targetTime);
        if (drift > 8 && item.duration > 0) { 
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
    document.getElementById('program-poster').src = "";
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
        videoElement.play().then(() => {
            updateMuteIcon();
        }).catch(e => {
            // Se falhar autoplay com som, muta e tenta de novo
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

// Quando o vídeo acaba, força verificação imediata do próximo
videoElement.addEventListener('ended', () => {
    console.log("Vídeo acabou. Buscando próximo...");
    checkScheduleLoop();
});

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
    
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const today = new Date().getDay();
    document.getElementById('schedule-day-label').innerText = days[today].toUpperCase();

    if(schedule.length === 0) {
        list.innerHTML = '<div class="text-zinc-500 text-xs text-center p-4">Grade vazia para hoje.</div>';
        return;
    }

    schedule.forEach(item => {
        // Verifica se é o item atual (pelo ID ou flag active)
        const isActive = (currentProgram && currentProgram.id === item.id);
        const el = document.createElement('div');
        // Estilo diferente para item ativo
        el.className = `flex items-center gap-3 p-3 rounded-xl transition-all ${isActive ? 'active-program bg-white/10 border-l-4 border-violet-500' : 'hover:bg-white/5 opacity-60 hover:opacity-100'}`;
        el.innerHTML = `
            <div class="text-center min-w-[50px]">
                <div class="text-sm font-bold text-white font-mono">${item.time}</div>
                ${isActive ? '<div class="text-[10px] text-violet-400 font-bold animate-pulse">NO AR</div>' : ''}
            </div>
            <img src="${item.image || ''}" class="w-10 h-14 object-cover rounded bg-black">
            <div class="min-w-0">
                <div class="text-sm font-bold text-white truncate">${item.title}</div>
                <div class="text-[10px] text-zinc-400">${item.category} • ${item.duration}m</div>
            </div>
        `;
        // Scroll automático para o item ativo na barra lateral
        if(isActive) setTimeout(() => el.scrollIntoView({behavior: "smooth", block: "center"}), 500);
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

// Mouse controls
let timer;
const controls = document.getElementById('video-controls');
const container = document.getElementById('video-wrapper');
const handleMove = () => {
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
container.addEventListener('mousemove', handleMove);
container.addEventListener('click', handleMove); // Touch support