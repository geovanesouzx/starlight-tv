import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, collection, limit, query, setDoc, getDoc, addDoc, updateDoc, deleteDoc, orderBy, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
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

// API KEYS
const GIPHY_API_KEY = "8Zuu3f4ZbDCcWUOP6HptgzrJ4ZCPN0ZN";

// Elementos
const videoElement = document.getElementById('main-video');
const appContainer = document.getElementById('app-container');
const giphyModal = document.getElementById('giphy-modal');
const confirmModal = document.getElementById('confirm-modal');
const programModal = document.getElementById('program-modal');
const settingsModal = document.getElementById('settings-modal');

// Estado
let schedule = [];
let currentProgram = null;
let hls = null;
let globalSettings = {};
let currentUserData = null;
let isVideoFitCover = true;
let replyTo = null;
let messageToDelete = null;
let typingTimeout = null;
let controlsTimeout = null; // Timer para o player

const CHAT_COLORS = [
    '#8b5cf6', '#ef4444', '#f97316', '#f59e0b', '#84cc16', 
    '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#d946ef', 
    '#f43f5e', '#64748b', '#ffffff'
];

let selectedMyColor = '#8b5cf6';

// Relógio
setInterval(() => {
    const now = new Date();
    document.getElementById('clock-display').innerText = now.toLocaleTimeString('pt-BR');
}, 1000);

// --- UTILS ---
window.showToast = (msg, type = 'info') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    let icon = type === 'error' ? 'alert-circle' : 'check-circle';
    toast.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5 ${type === 'error' ? 'text-red-500' : 'text-violet-500'}"></i> ${msg}`;
    container.appendChild(toast);
    lucide.createIcons();
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-20px)'; setTimeout(() => toast.remove(), 300); }, 3000);
};

// --- GIPHY ---
let debounceTimer;
window.debounceSearchGiphy = (val) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchGiphy(val), 500);
};

window.toggleGiphy = () => {
    if(giphyModal.classList.contains('hidden')) {
        giphyModal.classList.remove('hidden');
        searchGiphy('trending');
        setTimeout(() => {
            giphyModal.classList.remove('opacity-0');
            const content = document.getElementById('giphy-content');
            if(content) content.classList.remove('scale-95');
        }, 10);
    } else {
        giphyModal.classList.add('opacity-0');
        const content = document.getElementById('giphy-content');
        if(content) content.classList.add('scale-95');
        setTimeout(() => giphyModal.classList.add('hidden'), 300);
    }
};

async function searchGiphy(query) {
    const container = document.getElementById('giphy-results');
    container.innerHTML = '<div class="col-span-2 text-center text-sm py-4">Carregando...</div>';
    
    const endpoint = query === 'trending' || !query
        ? `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20&rating=g`
        : `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${query}&limit=20&rating=g`;

    try {
        const res = await fetch(endpoint);
        const data = await res.json();
        container.innerHTML = '';
        data.data.forEach(gif => {
            const img = document.createElement('img');
            img.src = gif.images.fixed_height_small.url;
            img.className = 'gif-item';
            img.onclick = () => sendGifMessage(gif.images.fixed_height.url);
            container.appendChild(img);
        });
    } catch(e) {
        container.innerHTML = '<div class="col-span-2 text-center text-red-500 text-sm">Erro ao carregar GIFs</div>';
    }
}

async function sendGifMessage(url) {
    toggleGiphy();
    if(!auth.currentUser) return;
    sendMessageInternal(url, 'gif');
}

// --- UPLOAD FOTO ---
window.uploadToCatbox = async (input) => {
    const file = input.files[0];
    if(!file) return;

    const statusEl = document.getElementById('upload-status');
    statusEl.classList.remove('hidden');
    statusEl.innerText = "Enviando (Proxy)...";

    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('userhash', '307daba6918600198381c9952');
    formData.append('fileToUpload', file);

    try {
        const response = await fetch('https://corsproxy.io/?' + encodeURIComponent('https://catbox.moe/user/api.php'), {
            method: 'POST', body: formData
        });
        if (!response.ok) throw new Error('Falha no upload via proxy');
        const url = await response.text();
        document.getElementById('edit-avatar').value = url.trim();
        previewAvatar(url.trim());
        showToast('Upload concluído!', 'success');
    } catch (error) {
        console.error("Erro upload:", error);
        showToast('Use um link direto de imagem.', 'error');
    } finally {
        statusEl.classList.add('hidden');
        input.value = ''; 
    }
};

window.previewAvatar = (url) => {
    const img = document.getElementById('settings-avatar-preview');
    if(!url) { img.src = "https://cdn-icons-png.flaticon.com/128/847/847969.png"; } 
    else { img.src = url; img.onerror = () => { img.src = "https://cdn-icons-png.flaticon.com/128/847/847969.png"; }; }
};

// --- CHAT LOGIC ---
window.sendMessage = async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text) return;
    
    input.value = '';
    if(window.innerWidth > 768) input.focus();
    
    await sendMessageInternal(text, 'text');
};

async function sendMessageInternal(content, type) {
    if(!currentUserData) return;

    const msgData = {
        text: content,
        type: type,
        username: currentUserData.username,
        userPhoto: currentUserData.photoURL || "https://cdn-icons-png.flaticon.com/128/847/847969.png",
        userColor: currentUserData.chatColor || '#8b5cf6',
        uid: auth.currentUser.uid,
        timestamp: serverTimestamp()
    };

    if(replyTo) {
        msgData.replyTo = replyTo;
        cancelReply();
    }

    try {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'chat'), msgData);
    } catch(e) { console.error("Erro msg:", e); }
}

function initChat() {
    const chatRef = collection(db, 'artifacts', appId, 'public', 'data', 'chat');
    const q = query(chatRef, orderBy('timestamp', 'asc'), limit(50));
    
    onSnapshot(q, (snap) => {
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        snap.forEach(docSnap => {
            const msg = docSnap.data();
            renderMessage(docSnap.id, msg, container);
        });
        container.scrollTop = container.scrollHeight;
        lucide.createIcons();
    });

    // Listener para "Quem está digitando"
    const typingRef = collection(db, 'artifacts', appId, 'public', 'data', 'typing');
    onSnapshot(typingRef, (snap) => {
        const now = Date.now();
        const typingUsers = [];
        snap.forEach(doc => {
            const data = doc.data();
            if (data.timestamp && (now - data.timestamp.toMillis()) < 5000 && doc.id !== auth.currentUser.uid) {
                typingUsers.push(data.username);
            }
        });
        
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            if (typingUsers.length > 0) {
                indicator.innerText = `${typingUsers.join(', ')} está digitando...`;
                indicator.classList.remove('opacity-0');
            } else {
                indicator.classList.add('opacity-0');
            }
        }
    });
}

function renderMessage(id, msg, container) {
    const el = document.createElement('div');
    const isMe = msg.uid === auth.currentUser.uid;
    const avatarUrl = msg.userPhoto || "https://cdn-icons-png.flaticon.com/128/847/847969.png";
    const nameColor = msg.userColor || '#8b5cf6';
    
    el.className = `chat-msg ${isMe ? 'mine' : ''} flex gap-3 mb-2 group relative`;
    el.dataset.id = id; 
    el.dataset.username = msg.username;
    el.dataset.text = msg.type === 'gif' ? 'GIF' : msg.text;

    let content = `<div class="leading-snug break-words text-sm opacity-90">${msg.text}</div>`;
    if(msg.type === 'gif') {
        content = `<img src="${msg.text}" class="rounded-lg mt-1 max-w-[200px] h-auto border border-white/10">`;
    }

    let replyBlock = '';
    if(msg.replyTo) {
        replyBlock = `
            <div class="text-[10px] bg-black/30 rounded px-2 py-1 mb-1 border-l-2 border-white/30 truncate max-w-[200px] select-none">
                <span class="font-bold opacity-70">${msg.replyTo.username}</span>: ${msg.replyTo.text}
            </div>
        `;
    }

    const actions = `
        <div class="msg-actions">
            <div class="msg-action-btn" onclick="startReply('${id}', '${msg.username}', '${msg.type==='gif'?'GIF':msg.text}')" title="Responder"><i data-lucide="reply" class="w-3 h-3"></i></div>
            ${isMe ? `<div class="msg-action-btn delete" onclick="openDeleteModal('${id}')" title="Apagar"><i data-lucide="trash-2" class="w-3 h-3"></i></div>` : ''}
        </div>
    `;

    if(isMe) {
         el.innerHTML = `
            ${actions}
            <div class="flex flex-col items-end min-w-0 w-full">
                ${replyBlock}
                <span class="text-[10px] font-bold uppercase tracking-wide mb-0.5" style="color: ${nameColor}">${msg.username}</span>
                ${content}
            </div>
        `;
    } else {
        el.innerHTML = `
            ${actions}
            <img src="${avatarUrl}" class="w-8 h-8 rounded-full object-cover shrink-0 bg-white/10 border border-white/5 self-start mt-1">
            <div class="flex flex-col min-w-0 w-full">
                ${replyBlock}
                <span class="text-[10px] font-bold uppercase tracking-wide mb-0.5" style="color: ${nameColor}">${msg.username}</span>
                ${content}
            </div>
        `;
    }
    
    initSwipeToReply(el, id, msg.username, msg.type === 'gif' ? 'GIF' : msg.text);
    container.appendChild(el);
}

// --- SWIPE TO REPLY ---
function initSwipeToReply(element, id, username, text) {
    if (window.innerWidth > 768) return;

    let startX = 0;
    let currentX = 0;
    let isSwiping = false;
    
    element.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isSwiping = false;
        element.style.transition = 'none';
    }, {passive: true});

    element.addEventListener('touchmove', (e) => {
        const touchX = e.touches[0].clientX;
        const diff = touchX - startX;
        
        if (diff > 0 && diff < 100) {
            currentX = diff;
            element.style.transform = `translateX(${currentX}px)`;
            isSwiping = true;
        }
    }, {passive: true});

    element.addEventListener('touchend', () => {
        element.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
        if (currentX > 60 && isSwiping) {
            startReply(id, username, text);
            if (navigator.vibrate) navigator.vibrate(50);
        }
        element.style.transform = 'translateX(0)';
        currentX = 0;
        isSwiping = false;
    });
}

// --- TYPING INDICATOR ---
const chatInput = document.getElementById('chat-input');
chatInput.addEventListener('input', () => {
    if (!auth.currentUser || !currentUserData) return;
    
    clearTimeout(typingTimeout);
    
    const typingRef = doc(db, 'artifacts', appId, 'public', 'data', 'typing', auth.currentUser.uid);
    setDoc(typingRef, {
        username: currentUserData.username,
        timestamp: serverTimestamp()
    });

    typingTimeout = setTimeout(() => {}, 5000);
});


// --- REPLY/DELETE UI ---
window.startReply = (id, username, text) => {
    replyTo = { id, username, text };
    document.getElementById('reply-bar').classList.remove('hidden');
    document.getElementById('reply-target-name').innerText = username;
    document.getElementById('chat-input').focus();
};

window.cancelReply = () => {
    replyTo = null;
    document.getElementById('reply-bar').classList.add('hidden');
};

window.openDeleteModal = (id) => {
    messageToDelete = id;
    confirmModal.classList.remove('hidden');
    setTimeout(() => confirmModal.classList.remove('opacity-0'), 10);
};

window.closeConfirmModal = () => {
    confirmModal.classList.add('opacity-0');
    setTimeout(() => confirmModal.classList.add('hidden'), 300);
    messageToDelete = null;
};

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
    if(!messageToDelete) return;
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'chat', messageToDelete));
        showToast('Mensagem apagada.');
        closeConfirmModal();
    } catch(e) { 
        showToast('Erro ao apagar.', 'error');
        closeConfirmModal();
    }
});

// --- SETTINGS & AUTH ---
function renderColorPickers() {
    const container = document.getElementById('color-picker-container');
    container.innerHTML = '';
    CHAT_COLORS.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `w-8 h-8 rounded-full transition color-option ${selectedMyColor === color ? 'selected' : ''}`;
        btn.style.backgroundColor = color;
        btn.onclick = () => { 
            selectedMyColor = color; 
            renderColorPickers(); 
        };
        container.appendChild(btn);
    });
}

window.toggleSettings = () => {
    if(settingsModal.classList.contains('hidden')) {
        settingsModal.classList.remove('hidden');
        if(currentUserData) {
            document.getElementById('edit-username').value = currentUserData.username || '';
            document.getElementById('edit-avatar').value = currentUserData.photoURL || '';
            previewAvatar(currentUserData.photoURL || '');
            if(currentUserData.chatColor) selectedMyColor = currentUserData.chatColor;
            renderColorPickers();
        }
        setTimeout(() => {
            settingsModal.classList.remove('opacity-0');
            const content = document.getElementById('settings-content');
            if(content) content.classList.remove('scale-95');
        }, 10);
    } else {
        settingsModal.classList.add('opacity-0');
        const content = document.getElementById('settings-content');
        if(content) content.classList.add('scale-95');
        setTimeout(() => settingsModal.classList.add('hidden'), 300);
    }
};

window.switchSettingsTab = (tab) => {
    const pBtn = document.getElementById('set-tab-profile');
    const aBtn = document.getElementById('set-tab-appearance');
    const pContent = document.getElementById('set-content-profile');
    const aContent = document.getElementById('set-content-appearance');

    if(tab === 'profile') {
        pBtn.className = "text-sm font-bold pb-2 border-b-2 border-violet-500 text-violet-500 transition";
        aBtn.className = "text-sm font-bold pb-2 border-b-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition";
        pContent.classList.remove('hidden'); aContent.classList.add('hidden');
    } else {
        aBtn.className = "text-sm font-bold pb-2 border-b-2 border-violet-500 text-violet-500 transition";
        pBtn.className = "text-sm font-bold pb-2 border-b-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition";
        aContent.classList.remove('hidden'); pContent.classList.add('hidden');
    }
};

window.toggleTheme = () => {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    const btn = document.getElementById('theme-btn').firstElementChild;
    const track = document.getElementById('theme-btn');
    if(isLight) { btn.style.transform = 'translateX(0px)'; track.classList.replace('bg-zinc-700', 'bg-violet-500'); } 
    else { btn.style.transform = 'translateX(24px)'; track.classList.replace('bg-violet-500', 'bg-zinc-700'); }
};

window.saveSettings = async () => {
    if(!auth.currentUser) return;
    const newUsername = document.getElementById('edit-username').value.trim();
    const newAvatar = document.getElementById('edit-avatar').value.trim();
    if(newUsername.length < 3) return showToast("Nome muito curto.", 'error');

    try {
        const updates = { username: newUsername, photoURL: newAvatar, chatColor: selectedMyColor };
        await updateDoc(doc(db, 'artifacts', appId, 'users', auth.currentUser.uid), updates);
        currentUserData = { ...currentUserData, ...updates };
        toggleSettings(); showToast("Perfil atualizado!", 'success');
    } catch(e) { console.error(e); showToast("Erro ao salvar perfil.", 'error'); }
};

// --- AUTH & INIT ---
const savedTheme = localStorage.getItem('theme');
if(savedTheme === 'light') window.toggleTheme();

function unlockAudio() { videoElement.muted = false; updateMuteIcon(); videoElement.play().catch(() => {}); }

onAuthStateChanged(auth, async (user) => {
    const loginScreen = document.getElementById('login-screen');
    const usernameScreen = document.getElementById('username-screen');
    
    if (user) {
        loginScreen.classList.add('opacity-0'); setTimeout(() => loginScreen.classList.add('hidden'), 500);
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
    }
});

function enterApp(isAutoLogin = false) { 
    document.getElementById('username-screen').classList.add('hidden'); 
    appContainer.style.opacity = '1'; 
    if (!isAutoLogin) unlockAudio(); 
    initListeners(); 
    initChat(); 
    initPlayerControls(); // Inicia controle de auto-hide
    checkScheduleLoop(); 
    setInterval(checkScheduleLoop, 1000); 
}

// Listeners de Auth
document.getElementById('btn-do-login').addEventListener('click', () => { 
    const e = document.getElementById('login-email').value; 
    const p = document.getElementById('login-password').value; 
    if(!e || !p) return; 
    signInWithEmailAndPassword(auth, e, p).then(() => enterApp(false)).catch(err => showToast(err.message, 'error')); 
});

document.getElementById('btn-do-signup').addEventListener('click', () => { 
    const e = document.getElementById('login-email').value; 
    const p = document.getElementById('login-password').value; 
    if(!e || !p) return; 
    createUserWithEmailAndPassword(auth, e, p).then(() => enterApp(false)).catch(err => showToast(err.message, 'error')); 
});

document.getElementById('btn-save-username').addEventListener('click', async () => { 
    const username = document.getElementById('username-input').value.trim(); 
    if(username.length < 3) return showToast('Nome muito curto!', 'error'); 
    
    try { 
        const uid = auth.currentUser.uid; 
        await setDoc(doc(db, 'artifacts', appId, 'users', uid), { 
            username: username, 
            email: auth.currentUser.email, 
            photoURL: "", 
            chatColor: "#8b5cf6" 
        }, { merge: true }); 
        currentUserData = { username }; 
        enterApp(false); 
    } catch(e) { showToast("Erro ao salvar.", 'error'); } 
});

window.logout = () => signOut(auth).then(() => location.reload());

// --- VIDEO & SCHEDULE ---
function initListeners() {
    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'stream', 'live'), (snap) => {
        const data = snap.data();
        if(data && data.isLive) { 
            const now = Date.now(); 
            if (now - data.startTime < 5000) { 
                playProgram({ id: 'live_override', title: data.title, desc: data.desc, url: data.url, image: data.image, category: 'AO VIVO', duration: 0 }, 0); 
            } 
        }
    });
    
    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'schedule'), (snap) => {
        schedule = []; 
        const today = new Date().getDay(); 
        snap.forEach(d => { 
            const data = d.data(); 
            if (data.day === undefined || parseInt(data.day) === today) { 
                schedule.push({id: d.id, ...data}); 
            } 
        }); 
        schedule.sort((a,b) => a.time.localeCompare(b.time)); 
        renderScheduleSidebar(); 
        checkScheduleLoop();
    });
}

function checkScheduleLoop() {
    if(!auth.currentUser) return;
    const now = new Date(); 
    const currentMinutes = now.getHours() * 60 + now.getMinutes(); 
    let activeItem = schedule.find(item => item.active === true);
    
    if (!activeItem) { 
        activeItem = schedule.find(item => { 
            const [h, m] = item.time.split(':').map(Number); 
            const startMinutes = h * 60 + m; 
            const duration = parseInt(item.duration) || 30; 
            const endMinutes = startMinutes + duration; 
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

function playProgram(item, targetTime) {
    if (!currentProgram || currentProgram.id !== item.id) { 
        currentProgram = item; 
        loadStream(item.url, targetTime); 
        updateUI(item); 
    } else { 
        const drift = Math.abs(videoElement.currentTime - targetTime); 
        if (drift > 8 && item.duration > 0 && !videoElement.paused) { 
            videoElement.currentTime = targetTime; 
        } 
    }
}

function goStandby() {
    if(currentProgram === null) return; 
    currentProgram = null; 
    videoElement.pause(); 
    document.getElementById('standby-screen').classList.remove('hidden'); 
    document.getElementById('live-indicator').classList.add('hidden'); 
    document.getElementById('program-title').innerText = "Aguardando..."; 
    document.getElementById('program-category').innerText = "OFF AIR"; 
    
    // Limpar sinopse e imagem
    const descEl = document.getElementById('program-desc-mini');
    if(descEl) descEl.innerText = "";
    document.getElementById('player-poster-mini').classList.add('hidden');
}

function loadStream(url, startTime) {
    document.getElementById('standby-screen').classList.add('hidden'); 
    let finalUrl = url; 
    if (url.includes('api.anivideo.net')) { try { const u = new URL(url); if(u.searchParams.get('d')) finalUrl = u.searchParams.get('d'); } catch(e){} }
    
    const onReady = () => { 
        videoElement.currentTime = startTime; 
        videoElement.play().then(() => updateMuteIcon()).catch(() => { videoElement.muted = true; videoElement.play(); }); 
    };
    
    if (Hls.isSupported() && (finalUrl.includes('.m3u8') || url.includes('.m3u8'))) { 
        if (hls) hls.destroy(); 
        hls = new Hls(); 
        hls.loadSource(finalUrl); 
        hls.attachMedia(videoElement); 
        hls.on(Hls.Events.MANIFEST_PARSED, onReady); 
    } else { 
        videoElement.src = finalUrl; 
        videoElement.addEventListener('loadedmetadata', onReady, {once: true}); 
    }
}

function updateUI(item) {
    document.getElementById('program-title').innerText = item.title; 
    document.getElementById('program-category').innerText = item.category || 'PROGRAMA'; 
    document.getElementById('live-indicator').classList.remove('hidden'); 
    
    // Restaura informações do player (sinopse e poster)
    const descEl = document.getElementById('program-desc-mini');
    if(descEl) descEl.innerText = item.desc || "";

    const poster = document.getElementById('player-poster-mini'); 
    if(item.image) { poster.src = item.image; poster.classList.remove('hidden'); } else { poster.classList.add('hidden'); } 
    renderScheduleSidebar();
}

function renderScheduleSidebar() {
    const list = document.getElementById('schedule-list'); if(!list) return; 
    list.innerHTML = ''; 
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']; 
    const today = new Date().getDay(); 
    document.getElementById('schedule-day-label').innerText = days[today].toUpperCase();
    
    if(schedule.length === 0) { list.innerHTML = '<div class="text-[var(--text-secondary)] text-xs text-center p-4">Grade vazia para hoje.</div>'; return; }
    
    schedule.forEach(item => { 
        const isActive = (currentProgram && currentProgram.id === item.id) || item.active; 
        const el = document.createElement('div'); 
        el.onclick = () => openProgramModal(item.id); 
        el.className = `cursor-pointer flex items-center gap-3 p-3 rounded-lg transition-all ${isActive ? 'active-program bg-[var(--input-bg)]' : 'hover:bg-[var(--input-bg)] opacity-70 hover:opacity-100'}`; 
        el.innerHTML = ` 
            <div class="text-center w-12 shrink-0"> <div class="text-sm font-bold text-[var(--text-primary)] font-mono">${item.time}</div> ${isActive ? '<div class="text-[9px] text-violet-400 font-bold animate-pulse">NO AR</div>' : ''} </div> 
            <div class="min-w-0"> <div class="text-sm font-bold text-[var(--text-primary)] truncate">${item.title}</div> <div class="text-[10px] text-[var(--text-secondary)] truncate">${item.category || 'Programa'}</div> </div> 
        `; 
        list.appendChild(el); 
    });
}

function updateMuteIcon() { 
    const icon = document.getElementById('mute-icon'); 
    if(videoElement.muted) { icon.setAttribute('data-lucide', 'volume-x'); icon.classList.add('text-red-400'); } 
    else { icon.setAttribute('data-lucide', 'volume-2'); icon.classList.remove('text-red-400'); } 
    lucide.createIcons(); 
}

// Player Overlay Logic
function initPlayerControls() {
    const videoWrapper = document.getElementById('video-wrapper');
    const videoControls = document.getElementById('video-controls');

    if (videoWrapper && videoControls) {
        const showControls = () => {
            videoControls.style.opacity = '1';
            videoWrapper.style.cursor = 'default';
            clearTimeout(controlsTimeout);
            controlsTimeout = setTimeout(() => {
                if (!videoElement.paused) {
                    videoControls.style.opacity = '0';
                    videoWrapper.style.cursor = 'none';
                }
            }, 3000);
        };

        videoWrapper.addEventListener('mousemove', showControls);
        videoWrapper.addEventListener('click', showControls);
        videoWrapper.addEventListener('touchstart', showControls, {passive: true});
    }
}

// UI Controls
window.switchSidebarTab = (tab) => {
    const chatBtn = document.getElementById('tab-chat');
    const gradeBtn = document.getElementById('tab-grade');
    const chatContent = document.getElementById('content-chat');
    const gradeContent = document.getElementById('content-grade');
    
    if (tab === 'chat') {
        chatBtn.classList.add('active'); gradeBtn.classList.remove('active');
        chatContent.classList.remove('hidden'); gradeContent.classList.add('hidden');
        const msgs = document.getElementById('chat-messages'); if(msgs) msgs.scrollTop = msgs.scrollHeight;
    } else {
        gradeBtn.classList.add('active'); chatBtn.classList.remove('active');
        gradeContent.classList.remove('hidden'); chatContent.classList.add('hidden');
    }
};

window.toggleMute = () => { videoElement.muted = !videoElement.muted; updateMuteIcon(); };
window.toggleZoom = () => { isVideoFitCover = !isVideoFitCover; const zoomIcon = document.getElementById('zoom-icon'); if (isVideoFitCover) { videoElement.classList.add('force-cover'); videoElement.classList.remove('force-contain'); if(zoomIcon) zoomIcon.setAttribute('data-lucide', 'rectangle-horizontal'); } else { videoElement.classList.add('force-contain'); videoElement.classList.remove('force-cover'); if(zoomIcon) zoomIcon.setAttribute('data-lucide', 'minimize'); } lucide.createIcons(); };
window.toggleFullscreen = async () => { const wrapper = document.getElementById('video-wrapper'); const video = document.getElementById('main-video'); if (!document.fullscreenElement) { try { if (wrapper.requestFullscreen) { await wrapper.requestFullscreen(); } else if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; } if (screen.orientation && screen.orientation.lock) { await screen.orientation.lock('landscape').catch(e => {}); } } catch (err) { console.error("Erro fullscreen:", err); } } else { try { await document.exitFullscreen(); if (screen.orientation && screen.orientation.unlock) { screen.orientation.unlock(); } } catch (err) { console.error("Erro exit fullscreen:", err); } } };

window.openProgramModal = (itemId) => { 
    const item = schedule.find(i => i.id === itemId); 
    if(!item) return; 
    document.getElementById('modal-title').innerText = item.title; 
    document.getElementById('modal-category').innerText = item.category || 'PROGRAMA'; 
    document.getElementById('modal-desc').innerText = item.desc || 'Sem sinopse disponível.'; 
    document.getElementById('modal-time').innerText = item.time; 
    const img = document.getElementById('modal-img'); 
    img.src = item.image || "https://cdn-icons-png.flaticon.com/128/705/705062.png"; 
    img.onerror = () => { img.src = "https://cdn-icons-png.flaticon.com/128/705/705062.png"; }; 
    
    // Simplificada lógica de exibição para evitar bugs
    programModal.classList.remove('hidden');
    // Pequeno delay para permitir que o navegador renderize o display block antes da opacidade
    setTimeout(() => {
        programModal.classList.remove('opacity-0');
        const content = document.getElementById('program-modal-content');
        if(content) content.classList.remove('scale-95');
    }, 50);
};

window.closeProgramModal = () => { 
    programModal.classList.add('opacity-0'); 
    const content = document.getElementById('program-modal-content');
    if(content) content.classList.add('scale-95'); 
    setTimeout(() => programModal.classList.add('hidden'), 300); 
};