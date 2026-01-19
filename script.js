import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, collection, getDocs, limit, query, setDoc, getDoc, addDoc, orderBy, serverTimestamp, where, updateDoc, deleteDoc, increment, runTransaction } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
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

// API KEYS (Main + Fallback Array)
const IMGUR_CLIENT_ID = "513bb727cecf9ac";
// Fallback keys for GIPHY to handle errors
const GIPHY_KEYS = [
    "8Zuu3f4ZbDCcWUOP6HptgzrJ4ZCPN0ZN", 
    "wSTSkifLdmqGRMEg1MXb0V3zD2uhxOTT", 
    "cGu3Z94KLsIUcHdcudiNsGwWxkN5XeuY"
];
let currentGiphyKeyIndex = 0;

// Elementos DOM
const videoElement = document.getElementById('main-video');
const standbyScreen = document.getElementById('standby-screen');
const loginScreen = document.getElementById('login-screen');
const usernameScreen = document.getElementById('username-screen');
const appContainer = document.getElementById('app-container');

// Estado
let schedule = [];
let currentProgramId = null; // ID do programa atual para evitar reloads
let hls = null;
let globalSettings = {};
let currentUserData = null;
let isVideoFitCover = true;
let selectedTheme = 'default';
let replyingTo = null; // Stores message object being replied to
let longPressTimer = null;
let pendingDeleteId = null;
let localTickerEnabled = localStorage.getItem('local_ticker_enabled') !== 'false';
let manualLiveStream = null; // Para guardar o estado de live manual

// ==========================================
// 0. UI HELPERS (Settings, Themes, Modals)
// ==========================================

window.toggleLocalTicker = (isChecked) => {
    localTickerEnabled = isChecked;
    localStorage.setItem('local_ticker_enabled', isChecked);
    updateTickerVisibility();
};

if(document.getElementById('pref-ticker')) {
    document.getElementById('pref-ticker').checked = localTickerEnabled;
}

// --- NOVO: SISTEMA DE DIÁLOGO CUSTOMIZADO ---
// type: 'alert' | 'confirm' | 'success' | 'error'
window.showDialog = ({ title, message, type = 'alert', confirmText = 'Confirmar', cancelText = 'Cancelar', onConfirm = null }) => {
    const dialog = document.getElementById('custom-dialog');
    const dTitle = document.getElementById('custom-dialog-title');
    const dMessage = document.getElementById('custom-dialog-message');
    const dActions = document.getElementById('custom-dialog-actions');
    const dIconContainer = document.getElementById('dialog-icon-container');
    const dIcon = document.getElementById('dialog-icon');

    dTitle.innerText = title;
    dMessage.innerText = message;
    dActions.innerHTML = '';

    // Icon & Color Logic
    dIconContainer.className = 'dialog-icon mb-4';
    dTitle.className = 'text-xl font-bold mb-2 font-[Outfit]';

    if (type === 'error') {
        dIcon.setAttribute('data-lucide', 'alert-triangle');
        dIconContainer.classList.add('bg-red-500/20', 'text-red-400');
        dTitle.classList.add('text-red-400');
    } else if (type === 'success') {
        dIcon.setAttribute('data-lucide', 'check-circle');
        dIconContainer.classList.add('bg-emerald-500/20', 'text-emerald-400');
        dTitle.classList.add('text-emerald-400');
    } else if (type === 'confirm') {
            dIcon.setAttribute('data-lucide', 'help-circle');
            dIconContainer.classList.add('bg-[var(--primary-color)]', 'text-white', 'bg-opacity-20');
            dTitle.classList.add('text-white');
    } else {
            dIcon.setAttribute('data-lucide', 'info');
            dIconContainer.classList.add('bg-blue-500/20', 'text-blue-400');
            dTitle.classList.add('text-white');
    }
    lucide.createIcons();

    // Buttons Logic
    if (type === 'confirm') {
        const btnCancel = document.createElement('button');
        btnCancel.className = 'dialog-btn dialog-btn-secondary';
        btnCancel.innerText = cancelText;
        btnCancel.onclick = closeDialog;
        
        const btnConfirm = document.createElement('button');
        btnConfirm.className = 'dialog-btn dialog-btn-danger'; // Usually confirm is destructive (delete)
        btnConfirm.innerText = confirmText;
        btnConfirm.onclick = () => {
            if (onConfirm) onConfirm();
            closeDialog();
        };
        
        dActions.appendChild(btnCancel);
        dActions.appendChild(btnConfirm);
    } else {
        // Alert/Success/Error just needs OK
        const btnOk = document.createElement('button');
        btnOk.className = 'dialog-btn dialog-btn-primary';
        btnOk.innerText = 'OK';
        btnOk.onclick = closeDialog;
        dActions.appendChild(btnOk);
    }

    dialog.classList.add('open');
};

window.closeDialog = () => {
    document.getElementById('custom-dialog').classList.remove('open');
};

window.openSettings = () => {
    document.getElementById('settings-modal').classList.add('open');
    
    if(currentUserData) {
        document.getElementById('edit-username').value = currentUserData.username || '';
        document.getElementById('edit-avatar-url').value = currentUserData.avatar || '';
        if(auth.currentUser) {
            document.getElementById('settings-current-email').innerText = auth.currentUser.email;
        }
        window.updateAvatarPreview(currentUserData.avatar || '');
    }
};

window.closeSettings = () => {
    document.getElementById('settings-modal').classList.remove('open');
};

window.switchSettingsTab = (tab) => {
    const btnProfile = document.getElementById('btn-tab-profile');
    const btnThemes = document.getElementById('btn-tab-themes');
    const divProfile = document.getElementById('settings-profile');
    const divThemes = document.getElementById('settings-themes');

    if(tab === 'profile') {
        btnProfile.className = 'flex-1 py-2 rounded-lg text-sm font-bold transition bg-white/10 text-white';
        btnThemes.className = 'flex-1 py-2 rounded-lg text-sm font-bold transition text-zinc-400 hover:bg-white/5';
        divProfile.classList.remove('hidden');
        divThemes.classList.add('hidden');
    } else {
        btnThemes.className = 'flex-1 py-2 rounded-lg text-sm font-bold transition bg-white/10 text-white';
        btnProfile.className = 'flex-1 py-2 rounded-lg text-sm font-bold transition text-zinc-400 hover:bg-white/5';
        divThemes.classList.remove('hidden');
        divProfile.classList.add('hidden');
    }
};

window.updateAvatarPreview = (url) => {
    const img = document.getElementById('settings-avatar-preview');
    img.src = url || 'https://cdn-icons-png.flaticon.com/128/705/705062.png';
};

// --- IMGUR UPLOAD LOGIC ---
window.handleFileUpload = async (input) => {
    const file = input.files[0];
    if (!file) return;

    const statusEl = document.getElementById('upload-status');
    const urlInput = document.getElementById('edit-avatar-url');
    
    statusEl.innerText = "Enviando para o Imgur...";
    statusEl.classList.remove('hidden');

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch('https://api.imgur.com/3/image', {
            method: 'POST',
            headers: {
                Authorization: `Client-ID ${IMGUR_CLIENT_ID}`
            },
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            const url = data.data.link;
            urlInput.value = url;
            window.updateAvatarPreview(url);
            statusEl.innerText = "Upload concluído!";
            setTimeout(() => statusEl.classList.add('hidden'), 3000);
            
            window.showDialog({
                title: 'Upload Concluído',
                message: 'Sua imagem foi enviada com sucesso para o Imgur!',
                type: 'success'
            });

        } else {
            throw new Error('Falha no upload: ' + (data.data.error || 'Erro desconhecido'));
        }
    } catch (error) {
        console.error("Erro Imgur:", error);
        statusEl.innerText = "Erro no upload.";
        window.showDialog({
            title: 'Erro no Upload',
            message: 'Não foi possível enviar a imagem para o Imgur. Tente novamente ou use uma URL externa.',
            type: 'error'
        });
    }
};

window.saveProfileChanges = async () => {
    const btn = document.querySelector('button[onclick="saveProfileChanges()"]');
    const originalText = btn.innerText;
    btn.innerText = "SALVANDO...";
    btn.disabled = true;

    try {
        const newUsername = document.getElementById('edit-username').value.trim();
        const newAvatar = document.getElementById('edit-avatar-url').value.trim();
        const uid = auth.currentUser.uid;

        if(newUsername.length < 3) throw new Error("Nome muito curto");

        // Check username change (skip if same)
        if(newUsername !== currentUserData.username) {
            const checkRef = doc(db, 'artifacts', appId, 'usernames', newUsername.toLowerCase());
            const checkSnap = await getDoc(checkRef);
            if(checkSnap.exists()) throw new Error("Nome já em uso");
            
            // Release old
            await setDoc(doc(db, 'artifacts', appId, 'usernames', currentUserData.username.toLowerCase()), {}, {delete: true}); 
            await setDoc(checkRef, { uid });
        }

        await updateDoc(doc(db, 'artifacts', appId, 'users', uid), {
            username: newUsername,
            avatar: newAvatar
        });

        currentUserData.username = newUsername;
        currentUserData.avatar = newAvatar;
        
        window.closeSettings();
        window.showDialog({
            title: 'Sucesso',
            message: 'Perfil atualizado com sucesso!',
            type: 'success'
        });

    } catch(e) {
        window.showDialog({
            title: 'Erro',
            message: e.message,
            type: 'error'
        });
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

window.setTheme = (themeId) => {
    document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-theme-id="${themeId}"]`).classList.add('active');
    
    if(themeId === 'default') {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', themeId);
    }
    selectedTheme = themeId;
    localStorage.setItem('starlight_theme', themeId);
};

const savedTheme = localStorage.getItem('starlight_theme');
if(savedTheme) window.setTheme(savedTheme);


// ==========================================
// 1. FLUXO DE AUTENTICAÇÃO E AUDIO FIX
// ==========================================

function unlockAudio() {
    videoElement.muted = false;
    updateMuteIcon();
    videoElement.play().catch(() => {});
}

window.performLogout = () => {
    const btn = document.querySelector('button[onclick="performLogout()"]');
    btn.innerText = "SAINDO...";
    signOut(auth).then(() => {
        location.reload();
    });
};

// PRESENCE SYSTEM COM HEARTBEAT (Contagem Real)
let heartbeatInterval;

function startPresenceHeartbeat(user) {
    if(!user) return;
    
    // Função para atualizar o timestamp
    const pulse = () => {
        const presenceRef = doc(db, 'artifacts', appId, 'presence', user.uid);
        setDoc(presenceRef, {
            uid: user.uid,
            timestamp: serverTimestamp() // Importante: usa hora do servidor
        });
    };

    pulse(); // Primeiro pulso
    // Atualiza a cada 60 segundos
    heartbeatInterval = setInterval(pulse, 60000); 

    // Limpeza ao fechar
    window.addEventListener('beforeunload', () => {
        const presenceRef = doc(db, 'artifacts', appId, 'presence', user.uid);
        deleteDoc(presenceRef);
    });
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Check if banned
        const banRef = doc(db, 'artifacts', appId, 'banned_users', user.uid);
        const banSnap = await getDoc(banRef);
        
        if (banSnap.exists()) {
            await signOut(auth);
            window.showDialog({
                title: 'Acesso Negado',
                message: 'Sua conta foi banida permanentemente desta plataforma.',
                type: 'error'
            });
            return;
        }

        startPresenceHeartbeat(user);

        loginScreen.classList.add('opacity-0', 'scale-110', 'pointer-events-none');
        setTimeout(() => loginScreen.classList.add('hidden'), 700);

        const userRef = doc(db, 'artifacts', appId, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists() && userSnap.data().username) {
            currentUserData = userSnap.data();
            enterApp(true);
        } else {
            usernameScreen.classList.remove('hidden');
        }
    } else {
        clearInterval(heartbeatInterval);
        loginScreen.classList.remove('hidden', 'opacity-0', 'scale-110', 'pointer-events-none');
        appContainer.style.opacity = '0';
    }
});

function enterApp(isAutoLogin = false) {
    usernameScreen.classList.add('hidden');
    appContainer.style.opacity = '1';
    
    if (!isAutoLogin) unlockAudio();
    
    initListeners();
    initChat();
    
    // Inicia o loop mestre de sincronização
    setInterval(masterSyncLoop, 1000);
    masterSyncLoop(); // Chama imediatamente
}

// Add touchstart to avoid delay on mobile
const btnLogin = document.getElementById('btn-do-login');
const handleLogin = (e) => {
    e.preventDefault();
    unlockAudio();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    if(!email || !pass) return;
    
    document.getElementById('login-error').classList.add('hidden');
    btnLogin.innerHTML = '<i class="animate-spin w-4 h-4 mr-2 inline"></i> CONECTANDO...';
    
    signInWithEmailAndPassword(auth, email, pass).then(() => {
        enterApp(false);
    }).catch(err => {
        btnLogin.innerHTML = 'CONECTAR';
        const el = document.getElementById('login-error');
        el.classList.remove('hidden');
    });
};

btnLogin.addEventListener('click', handleLogin);

document.getElementById('btn-do-signup').addEventListener('click', () => {
    unlockAudio();
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    if(!e || !p) return;

    document.getElementById('login-error').classList.add('hidden');
    const btn = document.getElementById('btn-do-signup');
    btn.innerText = 'CRIANDO...';

    createUserWithEmailAndPassword(auth, e, p).then(() => {
        enterApp(false);
    }).catch(err => {
        btn.innerText = 'CRIAR NOVA CONTA';
        const el = document.getElementById('login-error');
        el.classList.remove('hidden');
        if (err.code === 'auth/weak-password') el.innerHTML = 'Senha muito fraca (min 6 digitos).';
        else el.innerHTML = 'Erro ao criar conta.';
    });
});

document.getElementById('btn-save-username').addEventListener('click', async () => {
    unlockAudio();
    const username = document.getElementById('username-input').value.trim();
    if(username.length < 3) return;

    const errorEl = document.getElementById('username-error');
    errorEl.classList.add('hidden');
    const btn = document.getElementById('btn-save-username');
    btn.innerText = 'SALVANDO...';

    const usernameRef = doc(db, 'artifacts', appId, 'usernames', username.toLowerCase());
    const usernameSnap = await getDoc(usernameRef);

    if(usernameSnap.exists()) {
        errorEl.innerText = "Este nome de usuário já está em uso.";
        errorEl.classList.remove('hidden');
        btn.innerText = 'CONFIRMAR ID';
        return;
    }

    try {
        const uid = auth.currentUser.uid;
        await setDoc(usernameRef, { uid: uid });
        await setDoc(doc(db, 'artifacts', appId, 'users', uid), { 
            username: username,
            email: auth.currentUser.email,
            avatar: ''
        }, { merge: true });
        
        currentUserData = { username };
        enterApp(false);
    } catch(e) {
        console.error(e);
        btn.innerText = 'CONFIRMAR ID';
        errorEl.innerText = "Erro no sistema. Tente novamente.";
        errorEl.classList.remove('hidden');
    }
});

// 6. CHAT LOGIC - ENVIAR MENSAGEM
window.sendMessage = async (e, type = 'text', content = null) => {
    if(e) e.preventDefault();
    
    const input = document.getElementById('chat-input');
    const text = content || input.value.trim();
    
    if(!text || !currentUserData) return;

    if(type === 'text') {
        input.value = '';
        // Clear reply state if exists
        window.cancelReply();
    }
    if(type === 'text' && window.innerWidth > 768) input.focus();

    try {
        const payload = {
            text: text,
            type: type, // 'text' ou 'gif'
            username: currentUserData.username,
            avatar: currentUserData.avatar || '',
            uid: auth.currentUser.uid,
            timestamp: serverTimestamp()
        };
        
        // Add reply metadata if exists
        if (replyingTo) {
            payload.replyTo = {
                id: replyingTo.id,
                username: replyingTo.username,
                text: replyingTo.type === 'gif' ? '[GIF]' : replyingTo.text
            };
        }

        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'chat'), payload);
        replyingTo = null; // Ensure clear
    } catch(e) { console.error(e); }
};

// --- REPLY LOGIC ---
window.prepareReply = (msgId, username, text, type) => {
    replyingTo = { id: msgId, username, text, type };
    
    const replyBar = document.getElementById('reply-bar');
    const replyText = document.getElementById('reply-text');
    const input = document.getElementById('chat-input');
    
    const displayText = type === 'gif' ? '[GIF]' : (text.length > 30 ? text.substring(0,30) + '...' : text);
    
    replyText.innerHTML = `Respondendo a <strong>@${username}</strong>: <span class="opacity-70 italic">"${displayText}"</span>`;
    replyBar.classList.add('visible');
    input.focus();
};

window.cancelReply = () => {
    replyingTo = null;
    document.getElementById('reply-bar').classList.remove('visible');
};

// --- MOBILE GESTURES & CONTEXT MENU ---

// Open Context Menu (Delete)
function openContextMenu(msgId) {
    pendingDeleteId = msgId;
    document.getElementById('context-menu').classList.add('open');
    document.getElementById('context-overlay').classList.remove('hidden');
}

// Close Context Menu
window.closeContextMenu = () => {
    document.getElementById('context-menu').classList.remove('open');
    document.getElementById('context-overlay').classList.add('hidden');
    pendingDeleteId = null;
}

// Bind delete action
document.getElementById('context-delete-btn').addEventListener('click', () => {
    if(pendingDeleteId) {
        window.deleteMessage(pendingDeleteId);
        window.closeContextMenu();
    }
});

// Helper to add touch listeners to a message element
function addTouchListeners(element, msgData) {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchCurrentX = 0;
    
    // Swipe Logic
    element.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
        
        // Long Press Logic (Only for own messages)
        if(msgData.isMe) {
            longPressTimer = setTimeout(() => {
                openContextMenu(msgData.id);
                navigator.vibrate(50); // Feedback tactile
            }, 500); 
        }
    }, {passive: true});

    element.addEventListener('touchmove', (e) => {
        touchCurrentX = e.changedTouches[0].screenX;
        const deltaX = touchCurrentX - touchStartX;
        
        // If moving too much, cancel long press
        if(Math.abs(deltaX) > 10 || Math.abs(e.changedTouches[0].screenY - touchStartY) > 10) {
            clearTimeout(longPressTimer);
        }

        // Swipe Visual Feedback (Only Right Swipe)
        if(deltaX > 0) {
            element.style.transform = `translateX(${Math.min(deltaX, 100)}px)`;
            if(deltaX > 50) element.classList.add('swiping');
        }
    }, {passive: true});

    element.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer);
        const deltaX = touchCurrentX - touchStartX;
        
        element.style.transform = 'translateX(0)';
        element.classList.remove('swiping');

        // Trigger Reply if swiped far enough
        if (deltaX > 80) {
                window.prepareReply(msgData.id, msgData.username, msgData.text, msgData.type);
                navigator.vibrate(20);
        }
    });
    
    element.addEventListener('touchcancel', () => clearTimeout(longPressTimer));
}


// --- DELETE LOGIC ---
window.deleteMessage = async (msgId) => {
    // Se mobile (via context menu), pendingDeleteId estará setado.
    // Se desktop (clique direto), usamos o novo DIALOG em vez de confirm()
    
    const performDelete = async () => {
        try {
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'chat', msgId));
            // Optional: success feedback toast
        } catch(e) {
            console.error("Erro ao apagar", e);
            window.showDialog({title: "Erro", message: "Não foi possível apagar.", type: "error"});
        }
    };

    // Se for chamada via Context Menu (Mobile), já foi "confirmada" pela ação de clicar em Excluir
    if (pendingDeleteId) {
        await performDelete();
        return;
    }

    // Desktop confirmation via Custom Dialog
    window.showDialog({
        title: 'Apagar Mensagem',
        message: 'Tem certeza que deseja excluir esta mensagem permanentemente?',
        type: 'confirm',
        confirmText: 'Excluir',
        onConfirm: performDelete
    });
};

// --- GIPHY LOGIC (With Fallback) ---
window.toggleGifPicker = () => {
    const picker = document.getElementById('gif-picker');
    picker.classList.toggle('open');
    if(picker.classList.contains('open')) {
        searchGiphy(''); // Carrega trending
    }
};

window.searchGiphy = async (query) => {
    const container = document.getElementById('gif-results');
    container.innerHTML = '<div class="col-span-3 text-center text-xs text-zinc-500 py-4"><i class="animate-spin" data-lucide="loader"></i> Buscando...</div>';
    
    // Try with current key
    await attemptGiphyFetch(query, container);
};

async function attemptGiphyFetch(query, container, retryCount = 0) {
    const apiKey = GIPHY_KEYS[currentGiphyKeyIndex];
    const endpoint = query 
        ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${query}&limit=20&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=20&rating=g`;

    try {
        const res = await fetch(endpoint);
        
        // If API limit hit (429) or Forbidden (403), switch key
        if (res.status === 429 || res.status === 403) {
            throw new Error("Key limit reached");
        }

        const data = await res.json();
        
        container.innerHTML = '';
        
        if(data.data.length === 0) {
                container.innerHTML = '<div class="col-span-3 text-center text-xs text-zinc-500 py-4">Nenhum GIF encontrado.</div>';
                return;
        }

        data.data.forEach(gif => {
            const imgUrl = gif.images.fixed_height.url;
            const el = document.createElement('div');
            el.className = 'gif-item';
            el.onclick = () => {
                window.sendMessage(null, 'gif', imgUrl);
                window.toggleGifPicker();
            };
            el.innerHTML = `<img src="${gif.images.preview_gif.url}" loading="lazy" alt="GIF">`;
            container.appendChild(el);
        });

    } catch(e) {
        console.error("Giphy Error with key " + currentGiphyKeyIndex, e);
        
        // Retry logic with next key
        if (retryCount < GIPHY_KEYS.length - 1) {
            currentGiphyKeyIndex = (currentGiphyKeyIndex + 1) % GIPHY_KEYS.length;
            console.log("Switching to API Key index: " + currentGiphyKeyIndex);
            await attemptGiphyFetch(query, container, retryCount + 1);
        } else {
            container.innerHTML = '<div class="col-span-3 text-center text-xs text-red-400 py-4">Erro ao carregar GIPHY (Todos os servidores ocupados).</div>';
        }
    }
}


window.switchSidebarTab = (tab) => {
    const chatBtn = document.getElementById('tab-chat');
    const gradeBtn = document.getElementById('tab-grade');
    const chatContent = document.getElementById('content-chat');
    const gradeContent = document.getElementById('content-grade');
    
    const activeClasses = ['bg-white/10', 'text-white', 'shadow-lg'];
    const inactiveClasses = ['text-zinc-400', 'hover:text-white'];

    if (tab === 'chat') {
        chatBtn.classList.add(...activeClasses);
        chatBtn.classList.remove(...inactiveClasses);
        gradeBtn.classList.remove(...activeClasses);
        gradeBtn.classList.add(...inactiveClasses);

        chatContent.classList.remove('hidden');
        gradeContent.classList.add('hidden');
        
        const msgs = document.getElementById('chat-messages');
        if(msgs) msgs.scrollTop = msgs.scrollHeight;
    } else {
        gradeBtn.classList.add(...activeClasses);
        gradeBtn.classList.remove(...inactiveClasses);
        chatBtn.classList.remove(...activeClasses);
        chatBtn.classList.add(...inactiveClasses);

        gradeContent.classList.remove('hidden');
        chatContent.classList.add('hidden');
    }
};

window.toggleMute = () => {
    videoElement.muted = !videoElement.muted;
    updateMuteIcon();
};

window.toggleZoom = () => {
    isVideoFitCover = !isVideoFitCover;
    const zoomIcon = document.getElementById('zoom-icon');
    
    if (isVideoFitCover) {
        videoElement.style.objectFit = 'cover';
        if(zoomIcon) zoomIcon.setAttribute('data-lucide', 'rectangle-horizontal'); 
    } else {
        videoElement.style.objectFit = 'contain';
        if(zoomIcon) zoomIcon.setAttribute('data-lucide', 'minimize');
    }
    lucide.createIcons();
};

window.toggleFullscreen = async () => {
    const wrapper = document.getElementById('video-wrapper');
    const video = document.getElementById('main-video');

    if (!document.fullscreenElement) {
        try {
            if (wrapper.requestFullscreen) await wrapper.requestFullscreen();
            else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
            if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(()=>{});
        } catch (err) {}
    } else {
        try {
            await document.exitFullscreen();
            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
        } catch (err) {}
    }
};

// --- NEW: INTERACTION & CONTROLS VISIBILITY LOGIC ---
let controlsTimeout;
const wrapper = document.getElementById('video-wrapper');
const controls = document.getElementById('video-controls');

function showControls() {
    controls.style.opacity = '1';
    controls.style.pointerEvents = 'auto'; // Enable buttons
    wrapper.style.cursor = 'default';
    
    clearTimeout(controlsTimeout);
    
    // Only auto-hide if playing
    if (!videoElement.paused) {
        controlsTimeout = setTimeout(hideControls, 3000);
    }
}

function hideControls() {
    if (!videoElement.paused) {
        controls.style.opacity = '0';
        controls.style.pointerEvents = 'none'; // Disable buttons to click video
        wrapper.style.cursor = 'none';
    }
}

// Event Listeners for Interaction
wrapper.addEventListener('mousemove', showControls);
wrapper.addEventListener('click', (e) => {
    // Prevent immediate toggle if clicking control buttons
    if(e.target.closest('.control-btn-modern')) return;
    showControls();
});

// Ensure controls show on pause
videoElement.addEventListener('pause', showControls);
videoElement.addEventListener('play', () => {
    controlsTimeout = setTimeout(hideControls, 3000);
});


// 2. Data Listeners
function initListeners() {
    // Listen for Real Presence (With Filtering)
    onSnapshot(collection(db, 'artifacts', appId, 'presence'), (snap) => {
        let realCount = 0;
        const now = Date.now();
        // Filtra usuários que atualizaram o status nos últimos 2 minutos
        snap.forEach(doc => {
            const data = doc.data();
            if(data.timestamp) {
                // Converte Timestamp do Firestore para millis
                const lastSeen = data.timestamp.toMillis ? data.timestamp.toMillis() : 0;
                if(now - lastSeen < 120000) { // 2 minutos tolerância
                    realCount++;
                }
            }
        });
        document.getElementById('viewer-number').innerText = realCount;
    });

    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'stream', 'live'), (snap) => {
        const data = snap.data();
        manualLiveStream = data; // Guarda estado global
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

        // Check Reactions Enabled
        const reactionsContainer = document.getElementById('reactions-container');
        if(globalSettings.reactionsEnabled) {
            reactionsContainer.classList.add('active');
        } else {
            reactionsContainer.classList.remove('active');
        }
    });

    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'schedule'), (snap) => {
        schedule = [];
        // Carrega TODA a grade para lógica de transição, mas a UI foca no dia atual
        snap.forEach(d => {
            schedule.push({id: d.id, ...d.data()});
        });
        // Ordena por horário
        schedule.sort((a,b) => a.time.localeCompare(b.time));
        
        renderScheduleSidebar();
        // O loop mestre cuidará da atualização
    });

    // NEW: TICKER LISTENER (Manual text)
    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'widgets', 'ticker'), (snap) => {
        const data = snap.data();
        if(data) {
            globalSettings.manualTicker = data.text;
            globalSettings.tickerAuto = data.auto;
        }
    });

    // Listen for Reaction Total
    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'widgets', 'reactions'), (snap) => {
        const data = snap.data();
        const total = data ? (data.count || 0) : 0;
        document.getElementById('reaction-total-count').innerText = `${total} reações`;
    });

    // NEW: POLL LISTENER
    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'widgets', 'poll'), (snap) => {
        const data = snap.data();
        const widget = document.getElementById('poll-widget');
        const qEl = document.getElementById('poll-question');
        const optEl = document.getElementById('poll-options');
        
        if(!data || !data.active) {
            widget.classList.remove('active');
            return;
        }

        qEl.innerText = data.question;
        optEl.innerHTML = '';
        widget.classList.add('active');

        // Calc totals
        const total = Object.values(data.votes || {}).reduce((a,b)=>a+b, 0);
        const myVote = localStorage.getItem(`poll_voted_${snap.id}`); // Prevent multi vote

        data.options.forEach((opt, idx) => {
            const count = data.votes ? (data.votes[idx] || 0) : 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            
            const btn = document.createElement('button');
            btn.className = `poll-option-btn ${myVote == idx ? 'voted' : ''}`;
            if(myVote) btn.disabled = true;
            
            btn.innerHTML = `
                <div class="flex justify-between">
                    <span>${opt}</span>
                    <span>${pct}%</span>
                </div>
                <div class="poll-bar-bg"><div class="poll-bar-fill" style="width:${pct}%"></div></div>
            `;
            
            btn.onclick = () => castVote(idx);
            optEl.appendChild(btn);
        });
    });
}

// --- POLL VOTING ---
window.castVote = async (index) => {
    const pollRef = doc(db, 'artifacts', appId, 'public', 'data', 'widgets', 'poll');
    const pollSnap = await getDoc(pollRef);
    if(!pollSnap.exists()) return;
    
    if(localStorage.getItem(`poll_voted_${pollSnap.id}`)) return;

    localStorage.setItem(`poll_voted_${pollSnap.id}`, index);
    
    await updateDoc(pollRef, {
        [`votes.${index}`]: increment(1)
    });
};

// --- REACTIONS LOGIC ---
window.sendReaction = async (emoji) => {
    createFloatingReaction(emoji);
    
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'widgets', 'reactions'), {
            count: increment(1)
        });
    } catch(e) {
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'widgets', 'reactions'), {
            count: 1
        });
    }
};

function createFloatingReaction(emoji) {
    const el = document.createElement('div');
    el.innerText = emoji;
    el.className = 'floating-reaction';
    el.style.setProperty('--random-x', (Math.random() * 100 - 50) + 'px');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ==========================================
// 3. MASTER SYNC LOOP (O Coração da TV)
// ==========================================

function masterSyncLoop() {
    if(!auth.currentUser) return;
    
    // 1. Prioridade Absoluta: Transmissão Manual (Live Override)
    if(manualLiveStream && manualLiveStream.isLive) {
        // Se mudou para live manual agora, troca
        if(currentProgramId !== 'manual_live') {
            currentProgramId = 'manual_live';
            playProgram({
                title: manualLiveStream.title,
                desc: manualLiveStream.desc,
                category: 'AO VIVO',
                url: manualLiveStream.url,
                image: manualLiveStream.image,
                duration: 0 // Live não tem duração fixa de grade
            }, 0); // Começa do inicio (ou live edge)
        }
        return; // Não processa grade automática
    }

    // 2. Grade Automática baseada no horário do servidor (usando hora local confiável)
    const now = new Date();
    const currentDay = now.getDay(); // 0-6
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    
    // Encontra o programa que DEVERIA estar passando agora
    // Logica: StartTime <= Agora < StartTime + Duracao
    const activeItem = schedule.find(item => {
        if (parseInt(item.day) !== currentDay) return false;
        
        const [h, m] = item.time.split(':').map(Number);
        const startMins = h * 60 + m;
        const duration = parseInt(item.duration) || 30;
        const endMins = startMins + duration;
        
        return currentTotalMinutes >= startMins && currentTotalMinutes < endMins;
    });

    if (activeItem) {
        // Calcular em que ponto do vídeo devemos estar (seek)
        const [h, m] = activeItem.time.split(':').map(Number);
        const startTime = new Date();
        startTime.setHours(h, m, 0, 0);
        
        // Quantos segundos já passaram desde o inicio do programa
        const secondsSinceStart = (now.getTime() - startTime.getTime()) / 1000;

        // Se mudou o programa, carrega o novo
        if (currentProgramId !== activeItem.id) {
            currentProgramId = activeItem.id;
            playProgram(activeItem, secondsSinceStart);
        } else {
            // Se é o mesmo programa, verifica se des-sincronizou muito (> 5s)
            // Apenas para videos estáticos, não HLS live
            if (!videoElement.paused && Math.abs(videoElement.currentTime - secondsSinceStart) > 8) {
                // Sincronização forçada
                const syncBadge = document.getElementById('sync-status');
                syncBadge.classList.remove('hidden');
                videoElement.currentTime = secondsSinceStart;
                setTimeout(() => syncBadge.classList.add('hidden'), 2000);
            }
        }
        
        updateUI(activeItem);
    } else {
        // Nada na grade agora
        if(currentProgramId !== 'standby') {
            goStandby();
            currentProgramId = 'standby';
        }
    }

    // Ticker Logic update
    updateTickerLogic(currentTotalMinutes);
}

function updateTickerLogic(currentMinutes) {
    // Procura o próximo programa na grade de hoje
    const nextItem = schedule.find(item => {
        if(parseInt(item.day) !== new Date().getDay()) return false;
        const [h, m] = item.time.split(':').map(Number);
        const startMinutes = h * 60 + m;
        return startMinutes > currentMinutes;
    });

    const tickerEl = document.getElementById('ticker-float');
    const tickerText = document.getElementById('ticker-text');
    const tickerBadge = document.getElementById('ticker-badge');

    let showTicker = false;
    let message = "";
    let badge = "INFO";

    if (localTickerEnabled) {
            if (globalSettings.tickerAuto === false && globalSettings.manualTicker) {
                // Manual Mode
                showTicker = true;
                message = globalSettings.manualTicker;
                badge = "NEWS";
            } else if (nextItem) {
                // Auto Mode
                const [h, m] = nextItem.time.split(':').map(Number);
                const startMinutes = h * 60 + m;
                const diff = startMinutes - currentMinutes;

                if (diff <= 5 && diff > 0) {
                    showTicker = true;
                    message = `${nextItem.title} começa em ${diff} min`;
                    badge = "EM BREVE";
                } else if (diff <= 1) {
                    showTicker = true;
                    message = `A SEGUIR: ${nextItem.title}`;
                    badge = "A SEGUIR";
                }
            }
    }

    if (showTicker) {
        tickerText.innerText = message;
        tickerBadge.innerText = badge;
        tickerEl.classList.add('active');
    } else {
        tickerEl.classList.remove('active');
    }
}

function updateTickerVisibility() {
        const tickerEl = document.getElementById('ticker-float');
        if(!localTickerEnabled) tickerEl.classList.remove('active');
}


// 4. Player Logic
function playProgram(item, startTimeOffset) {
    loadStream(item.url, startTimeOffset);
    // UI Updates
    document.getElementById('program-title').innerText = item.title;
    document.getElementById('program-desc').innerText = item.desc || 'Sem descrição.';
    document.getElementById('program-category').innerText = item.category || 'NO AR';
    document.getElementById('live-indicator').classList.remove('hidden');
    renderScheduleSidebar();
}

function goStandby() {
    videoElement.pause();
    standbyScreen.classList.remove('hidden');
    document.getElementById('live-indicator').classList.add('hidden');
    document.getElementById('program-title').innerText = "AGUARDANDO";
    document.getElementById('program-desc').innerText = "Aguardando próxima transmissão.";
    document.getElementById('program-category').innerText = "OFF AIR";
}

function loadStream(url, startTime) {
    standbyScreen.classList.add('hidden');
    let finalUrl = url;
    
    // Tratamento básico de URLs
    if (url.includes('api.anivideo.net')) {
        try {
            const u = new URL(url);
            if(u.searchParams.get('d')) finalUrl = u.searchParams.get('d');
        } catch(e){}
    }

    const onReady = () => {
        // Se for HLS Live, o startTime geralmente é ignorado ou tratado diferente
        // Se for arquivo estático (mp4), pulamos para o ponto certo
        if(startTime > 0 && finalUrl.includes('.mp4')) {
             videoElement.currentTime = startTime;
        }
        
        videoElement.play().then(() => updateMuteIcon()).catch(() => {
            // Autoplay bloqueado? Muta e tenta de novo
            videoElement.muted = true;
            videoElement.play();
            updateMuteIcon();
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
        // Se for arquivo normal, seek imediatamente ao carregar metadados
        videoElement.onloadedmetadata = () => {
             if(startTime > 0) videoElement.currentTime = startTime;
             onReady();
        };
    }
}

// 5. UI Updates & Modal Logic
function updateUI(item) {
    // Isso já é chamado dentro do playProgram, mas se precisar forçar update visual:
    document.getElementById('program-title').innerText = item.title;
}

// PROGRAM MODAL LOGIC
window.openProgramDetails = (id) => {
    const item = schedule.find(p => p.id === id);
    if(!item) return;

    document.getElementById('modal-img').src = item.image || 'https://via.placeholder.com/500x300/000000/ffffff?text=Sem+Imagem';
    document.getElementById('modal-title').innerText = item.title;
    document.getElementById('modal-desc').innerText = item.desc || 'Sem descrição detalhada.';
    document.getElementById('modal-time').innerText = item.time;
    document.getElementById('modal-duration').innerText = (item.duration || 30) + " min";
    document.getElementById('modal-category').innerText = item.category || 'Geral';
    
    document.getElementById('program-modal').classList.add('open');
}

window.closeProgramModal = () => {
    document.getElementById('program-modal').classList.remove('open');
}

function renderScheduleSidebar() {
    const list = document.getElementById('schedule-list');
    if(!list) return;
    list.innerHTML = '';
    
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const today = new Date().getDay();
    document.getElementById('schedule-day-label').innerText = days[today].toUpperCase();

    // Filtra apenas o dia de hoje para mostrar na sidebar
    const todaysItems = schedule.filter(i => parseInt(i.day) === today);

    if(todaysItems.length === 0) {
        list.innerHTML = '<div class="text-zinc-500 text-xs text-center p-8 border border-white/5 rounded-xl border-dashed">Grade vazia hoje.</div>';
        return;
    }

    todaysItems.forEach(item => {
        // Verifica se é o programa atual
        const isActive = (currentProgramId === item.id);
        const el = document.createElement('div');
        el.onclick = () => window.openProgramDetails(item.id);
        el.className = `flex items-center gap-4 p-3 rounded-2xl transition-all border border-transparent cursor-pointer group ${isActive ? 'active-program-card shadow-lg' : 'hover:bg-white/5 opacity-60 hover:opacity-100 hover:border-white/5'}`;
        el.innerHTML = `
            <div class="text-center w-14 shrink-0 flex flex-col items-center justify-center">
                <div class="text-sm font-bold text-white font-[Outfit]">${item.time}</div>
                ${isActive ? '<div class="mt-1 w-1.5 h-1.5 bg-[var(--primary-color)] rounded-full animate-pulse shadow-[0_0_8px_var(--text-glow)]"></div>' : '<div class="mt-1 w-1 h-1 bg-zinc-700 rounded-full group-hover:bg-white transition-colors"></div>'}
            </div>
            <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold text-white truncate leading-snug">${item.title}</div>
                <div class="text-[10px] text-zinc-400 truncate uppercase tracking-wide font-medium mt-0.5">${item.category || 'Geral'}</div>
            </div>
            <i data-lucide="info" class="w-4 h-4 text-zinc-600 group-hover:text-white transition opacity-0 group-hover:opacity-100"></i>
        `;
        list.appendChild(el);
    });
    lucide.createIcons();
}

// 6. CHAT LOGIC (Initial load)
function initChat() {
    const chatRef = collection(db, 'artifacts', appId, 'public', 'data', 'chat');
    const q = query(chatRef, orderBy('timestamp', 'asc'), limit(50));
    
    onSnapshot(q, (snap) => {
        const container = document.getElementById('chat-messages');
        container.innerHTML = ''; 
        
        snap.forEach(d => {
            const msg = d.data();
            const msgId = d.id;
            const el = document.createElement('div');
            const isMe = msg.uid === auth.currentUser.uid;
            
            el.className = `flex flex-col mb-2 ${isMe ? 'items-end' : 'items-start'} fade-in-up group/msg relative transition-transform duration-200 ease-out`; 
            
            addTouchListeners(el, { id: msgId, username: msg.username, text: msg.text, type: msg.type, isMe: isMe });

            // Avatar Rendering Logic
            let avatarHtml = '';
            const avatarUrl = msg.avatar || 'https://cdn-icons-png.flaticon.com/128/705/705062.png';
            const avatarMargin = isMe ? 'ml-2' : 'mr-2';
            avatarHtml = `<img src="${avatarUrl}" class="w-8 h-8 rounded-full object-cover border border-white/10 ${avatarMargin} self-end mb-1 shadow-md bg-black/20">`;

            let contentHtml = '';
            let bubbleClass = '';
            let replyHtml = '';

            // Reply Context Render
            if (msg.replyTo) {
                replyHtml = `
                    <div class="reply-context">
                        <strong class="text-[var(--primary-color)]">@${msg.replyTo.username}</strong>: ${msg.replyTo.text}
                    </div>
                `;
            }

            if (msg.type === 'gif') {
                contentHtml = `<img src="${msg.text}" class="rounded-lg max-w-[200px] w-full object-cover shadow-lg" alt="GIF">`;
                bubbleClass = 'gif-mode'; 
            } else {
                contentHtml = `<div class="text-sm leading-relaxed break-words font-medium">${msg.text}</div>`;
                bubbleClass = isMe ? 'mine text-white' : 'other text-zinc-200';
            }
            
            let actionsHtml = '';
            actionsHtml += `
                    <div class="action-btn" onclick="prepareReply('${msgId}', '${msg.username}', '${msg.type === 'gif' ? msg.text : msg.text.replace(/'/g, "\\'")}', '${msg.type}')" title="Responder">
                    <i data-lucide="reply" class="w-3 h-3"></i>
                    </div>
            `;
            
            if (isMe) {
                actionsHtml += `
                        <div class="action-btn hover:bg-red-500 hover:border-red-500" onclick="deleteMessage('${msgId}')" title="Apagar">
                        <i data-lucide="trash-2" class="w-3 h-3"></i>
                        </div>
                `;
            }

            const swipeHint = `<div class="swipe-hint"><i data-lucide="reply" class="w-4 h-4"></i></div>`;

            el.innerHTML = `
                ${swipeHint}
                <div class="flex ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end max-w-[95%]">
                    ${avatarHtml}
                    <div class="chat-bubble ${bubbleClass} rounded-2xl py-2 px-3 backdrop-blur-sm relative transition-all">
                        <!-- Actions Overlay (Desktop) -->
                        <div class="chat-actions ${isMe ? 'right-0' : 'left-0'}">
                            ${actionsHtml}
                        </div>
                        
                        ${replyHtml}
                        ${!isMe && msg.type !== 'gif' ? `<div class="text-[9px] font-bold text-[var(--secondary-color)] mb-0.5 uppercase tracking-wide opacity-80">${msg.username}</div>` : ''}
                        ${contentHtml}
                    </div>
                </div>
            `;
            container.appendChild(el);
        });
        lucide.createIcons();
        container.scrollTop = container.scrollHeight;
    });
}

function updateMuteIcon() {
    const icon = document.getElementById('mute-icon');
    if(videoElement.muted) {
        icon.setAttribute('data-lucide', 'volume-x');
        icon.parentElement.classList.add('text-red-400', 'border-red-500/30');
    } else {
        icon.setAttribute('data-lucide', 'volume-2');
        icon.parentElement.classList.remove('text-red-400', 'border-red-500/30');
    }
    lucide.createIcons();
}

videoElement.addEventListener('timeupdate', () => {
    // Atualiza barra de progresso visual (apenas se tiver duração finita)
    if(videoElement.duration && videoElement.duration !== Infinity) {
        const pct = (videoElement.currentTime / videoElement.duration) * 100;
        const pbar = document.getElementById('progress-bar');
        if(pbar) pbar.style.width = `${pct}%`;
    }
});

setInterval(() => {
    const d = new Date();
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}, 1000);

lucide.createIcons();