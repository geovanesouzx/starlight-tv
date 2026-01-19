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

// ID FIXO (Não mude isso ou perderá a conexão com o Admin)
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
let globalSettings = {};
let currentUserData = null;
let isStarted = false; // Controla se o usuário já deu "Start"

// ==========================================
// 1. FLUXO DE AUTENTICAÇÃO
// ==========================================

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Usuário logado
        loginScreen.classList.add('hidden');

        // Buscar dados do usuário (nome)
        const userRef = doc(db, 'artifacts', appId, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists() && userSnap.data().username) {
            // Tem nome? Vai pra tela de permissão
            currentUserData = userSnap.data();
            showPermissionScreen();
        } else {
            // Não tem nome? Vai pra tela de username
            usernameScreen.classList.remove('hidden');
        }
    } else {
        // Não logado
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
    // Só mostra se ainda não iniciou a sessão de vídeo
    if (!isStarted) {
        permissionScreen.classList.remove('hidden');
    }
}

// Botão "ASSISTIR" (Obrigatório para som no Mobile)
document.getElementById('btn-permission-start').addEventListener('click', () => {
    isStarted = true;
    permissionScreen.classList.add('hidden'); // Some com a tela
    appContainer.style.opacity = '1'; // Mostra o app
    
    // Inicia os sistemas
    initListeners();
    initChat();
    
    // Tenta iniciar o áudio imediatamente (hack para iOS)
    videoElement.play().catch(() => {});
    
    // Força checagem da grade
    checkScheduleLoop();
});

// Login UI
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
    btn.innerText = isLoading ? "..." : "ENTRAR";
    btn.disabled = isLoading;
}

// Salvar Username
document.getElementById('btn-save-username').addEventListener('click', async () => {
    const username = document.getElementById('username-input').value.trim();
    if(username.length < 3) return alert('Nome muito curto!');

    const errorEl = document.getElementById('username-error');
    errorEl.classList.add('hidden');

    try {
        const uid = auth.currentUser.uid;
        // Salva no perfil do usuário
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

// Logout Global
window.logout = () => signOut(auth).then(() => location.reload());


// ==========================================
// 2. SINCRONIZAÇÃO E PLAYER (Core)
// ==========================================

function initListeners() {
    // Escuta mudanças na Grade
    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'schedule'), (snap) => {
        schedule = [];
        snap.forEach(d => schedule.push({id: d.id, ...d.data()}));
        schedule.sort((a,b) => a.time.localeCompare(b.time));
        renderScheduleSidebar();
        checkScheduleLoop(); // Recalcula assim que a grade muda
    });

    // Escuta Configurações (Manutenção)
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

// Lógica Principal de Sincronia
function checkScheduleLoop() {
    if(!isStarted) return;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    // 1. Prioridade: Item marcado manualmente como "No Ar" (Active)
    let activeItem = schedule.find(item => item.active === true);

    // 2. Fallback: Item baseado no horário matemático
    if (!activeItem) {
        activeItem = schedule.find(item => {
            const [h, m] = item.time.split(':').map(Number);
            const startMinutes = h * 60 + m;
            const endMinutes = startMinutes + parseInt(item.duration);
            return currentMinutes >= startMinutes && currentMinutes < endMinutes;
        });
    }

    if (activeItem) {
        // Calcular tempo decorrido desde o início do programa
        const [h, m] = activeItem.time.split(':').map(Number);
        
        // Cria objeto data para o horário de início HOJE
        const programStartTime = new Date();
        programStartTime.setHours(h, m, 0, 0);
        
        // Se o horário de início for maior que agora (ex: virada do dia), ajusta para ontem (raro, mas seguro)
        // Mas geralmente grade é do dia.
        
        // Diferença em segundos entre AGORA e o INÍCIO DO PROGRAMA
        // Ex: Agora 14:10, Início 14:00 -> elapsed = 600 segundos
        let elapsedSeconds = (now - programStartTime) / 1000;

        playProgram(activeItem, elapsedSeconds);
    } else {
        goStandby();
    }
}

// Checa a cada 1 segundo
setInterval(checkScheduleLoop, 1000);

function playProgram(item, targetTime) {
    // Se mudou o programa
    if (!currentProgram || currentProgram.id !== item.id) {
        console.log("Novo Programa Detectado:", item.title);
        currentProgram = item;
        loadStream(item.url, targetTime);
        updateUI(item);
    } else {
        // Se é o mesmo programa, verificar SINCRONIA FINA
        // targetTime é onde o vídeo DEVERIA estar agora.
        
        if (videoElement.paused) return; // Não força sync se pausado (ou carregando)

        const currentVideoTime = videoElement.currentTime;
        const drift = Math.abs(currentVideoTime - targetTime);

        // Se a diferença for maior que 4 segundos, pula para o tempo certo
        // (Isso corrige se alguém entrou atrasado ou o vídeo travou)
        if (drift > 4) {
            console.log(`Resincronizando... Desvio de ${drift.toFixed(1)}s`);
            
            // Mostra badge
            const syncBadge = document.getElementById('sync-status');
            syncBadge.classList.remove('hidden');
            
            // Pula
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
    
    // Tratamento básico de URL
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
            console.warn("Autoplay bloqueado pelo navegador. Usuário precisa interagir.", e);
            // O botão de permissão inicial deve prevenir isso, mas se falhar:
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
    document.getElementById('program-desc').innerText = item.desc || '';
    document.getElementById('program-category').innerText = item.category || 'NO AR';
    document.getElementById('program-poster').src = item.image || '';
    renderScheduleSidebar();
}

function renderScheduleSidebar() {
    const list = document.getElementById('schedule-list');
    list.innerHTML = '';
    
    if(schedule.length === 0) {
        list.innerHTML = '<div class="text-zinc-500 text-xs text-center p-4">Grade vazia.</div>';
        return;
    }

    schedule.forEach(item => {
        const isActive = (currentProgram && currentProgram.id === item.id) || item.active;
        const div = document.createElement('div');
        div.className = `program-item ${isActive ? 'active' : ''}`;
        div.innerHTML = `
            <div class="text-center min-w-[50px]">
                <div class="text-sm font-bold text-white font-mono">${item.time}</div>
                ${isActive ? '<div class="text-[10px] text-violet-400 font-bold animate-pulse mt-1">NO AR</div>' : ''}
            </div>
            <img src="${item.image || ''}" class="w-10 h-14 object-cover rounded bg-black/50">
            <div class="min-w-0 flex-1">
                <div class="text-sm font-bold text-white truncate">${item.title}</div>
                <div class="text-[10px] text-zinc-400">${item.category} • ${item.duration}m</div>
            </div>
        `;
        list.appendChild(div);
    });
}

function initChat() {
    const chatRef = collection(db, 'artifacts', appId, 'public', 'data', 'chat');
    // Limite de 50 mensagens para não pesar
    const q = query(chatRef, orderBy('timestamp', 'asc'), limit(50));
    
    onSnapshot(q, (snap) => {
        const container = document.getElementById('chat-messages');
        container.innerHTML = ''; // Limpa e recria (simples)
        
        let lastMsg = null; // Para verificar scroll

        snap.forEach(doc => {
            const msg = doc.data();
            const el = document.createElement('div');
            const isMe = auth.currentUser && msg.uid === auth.currentUser.uid;
            
            el.className = `chat-msg ${isMe ? 'mine' : ''}`;
            
            // Hora da mensagem
            const timeStr = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';

            el.innerHTML = `
                <div class="flex items-baseline justify-between mb-1 gap-2">
                    <span class="font-bold text-xs ${isMe ? 'text-violet-400' : 'text-zinc-400'}">${msg.username}</span>
                    <span class="text-[9px] text-zinc-600 opacity-50">${timeStr}</span>
                </div>
                <div class="text-sm text-zinc-200 break-words leading-snug">${msg.text}</div>
            `;
            container.appendChild(el);
            lastMsg = el;
        });
        
        // Auto scroll sempre que chegar msg nova
        if(lastMsg) lastMsg.scrollIntoView({ behavior: "smooth" });
    });
}

// Tornar global para o HTML acessar
window.sendMessage = async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text || !currentUserData) return;

    input.value = ''; // Limpa input rápido
    
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
    // UI Update
    document.getElementById('tab-grade').classList.toggle('active', tab === 'grade');
    document.getElementById('tab-chat').classList.toggle('active', tab === 'chat');
    
    // Content Update
    if(tab === 'grade') {
        document.getElementById('content-grade').classList.remove('hidden');
        document.getElementById('content-chat').classList.add('hidden');
    } else {
        document.getElementById('content-grade').classList.add('hidden');
        document.getElementById('content-chat').classList.remove('hidden');
        // Scroll to bottom
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;
    }
};

window.toggleMute = () => {
    videoElement.muted = !videoElement.muted;
    updateMuteIcon();
};

window.toggleFullscreen = () => {
    const el = document.getElementById('video-wrapper');
    if(document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen ? el.requestFullscreen() : el.classList.toggle('fake-fullscreen');
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

// Clock UI
setInterval(() => {
    const d = new Date();
    document.getElementById('clock').innerText = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}, 1000);

// Init Icons
lucide.createIcons();

// Mouse controls fading
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