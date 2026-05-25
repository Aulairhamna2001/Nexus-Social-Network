// ═══════════════════════════════════════════════════
//  app.js — Nexus Social Network
//  Main Application Logic
// ═══════════════════════════════════════════════════

import {
  auth, db, storage,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  collection, doc, getDoc, getDocs,
  setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit,
  onSnapshot, serverTimestamp,
  increment, arrayUnion, arrayRemove,
  startAfter,
  ref, uploadBytesResumable, getDownloadURL
} from './firebase.js';

// ══════════════════════════════════════
//  GLOBALS
// ══════════════════════════════════════
let currentUser      = null;
let currentUserData  = null;
let feedLastDoc      = null;
let feedLoading      = false;
let feedExhausted    = false;
let activeSection    = 'feed';
let activeChatUserId = null;
let chatUnsubscribe  = null;
let notifUnsubscribe = null;
let postImageFile    = null;
let currentCommentPostId = null;
let allUsersCache    = [];

const FEED_BATCH = 8;
const DEFAULT_AVATAR = uid =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(uid)}&background=1877f2&color=fff&size=128`;

// ══════════════════════════════════════
//  INIT — Auth State
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  onAuthStateChanged(auth, async user => {
    if (user) {
      currentUser = user;
      await loadCurrentUserData();
      showApp();
      initFeed();
      initNotifications();
      loadSuggestedUsers();
      loadAllUsers();
      loadChatList();
    } else {
      currentUser = null;
      currentUserData = null;
      showAuth();
    }

    // Hide loader after auth resolved
    setTimeout(() => {
      document.getElementById('pageLoader').classList.add('fade-out');
    }, 800);
  });

  // Infinite scroll
  window.addEventListener('scroll', handleInfiniteScroll);
});

// ══════════════════════════════════════
//  AUTH FLOWS
// ══════════════════════════════════════

// Switch login/register tab
window.switchTab = (tab) => {
  const loginForm  = document.getElementById('loginForm');
  const regForm    = document.getElementById('registerForm');
  const loginTab   = document.getElementById('loginTab');
  const regTab     = document.getElementById('registerTab');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
    loginTab.classList.add('active');
    regTab.classList.remove('active');
  } else {
    loginForm.classList.add('hidden');
    regForm.classList.remove('hidden');
    loginTab.classList.remove('active');
    regTab.classList.add('active');
  }
};

// Register
window.registerUser = async () => {
  const firstName = document.getElementById('regFirstName').value.trim();
  const lastName  = document.getElementById('regLastName').value.trim();
  const username  = document.getElementById('regUsername').value.trim().toLowerCase();
  const email     = document.getElementById('regEmail').value.trim();
  const password  = document.getElementById('regPassword').value;

  // Validation
  if (!firstName || !lastName) return showToast('Masukkan nama depan dan belakang', 'error');
  if (!username || username.length < 3) return showToast('Username minimal 3 karakter', 'error');
  if (!/^[a-z0-9._]+$/.test(username)) return showToast('Username hanya huruf, angka, titik, underscore', 'error');
  if (!email) return showToast('Masukkan email', 'error');
  if (password.length < 6) return showToast('Password minimal 6 karakter', 'error');

  const btn = document.querySelector('#registerForm .btn-primary');
  setLoading(btn, true);

  try {
    // Check username taken
    const uSnap = await getDocs(query(collection(db, 'users'), where('username', '==', username)));
    if (!uSnap.empty) { showToast('Username sudah dipakai, coba lain', 'error'); setLoading(btn, false); return; }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    await updateProfile(cred.user, {
      displayName: `${firstName} ${lastName}`,
      photoURL: DEFAULT_AVATAR(`${firstName}+${lastName}`)
    });

    // Save user doc
    await setDoc(doc(db, 'users', uid), {
      uid,
      firstName, lastName,
      displayName: `${firstName} ${lastName}`,
      username,
      email,
      photoURL: DEFAULT_AVATAR(`${firstName}+${lastName}`),
      bio: '',
      location: '',
      followers: [],
      following: [],
      postCount: 0,
      createdAt: serverTimestamp()
    });

    showToast('Akun berhasil dibuat!', 'success');
  } catch (err) {
    showToast(firebaseError(err.code), 'error');
  } finally {
    setLoading(btn, false);
  }
};

// Login
window.loginUser = async () => {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email) return showToast('Masukkan email', 'error');
  if (!password) return showToast('Masukkan password', 'error');

  const btn = document.querySelector('#loginForm .btn-primary');
  setLoading(btn, true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    showToast('Selamat datang kembali!', 'success');
  } catch (err) {
    showToast(firebaseError(err.code), 'error');
  } finally {
    setLoading(btn, false);
  }
};

// Logout
window.logoutUser = async () => {
  if (chatUnsubscribe) chatUnsubscribe();
  if (notifUnsubscribe) notifUnsubscribe();
  await signOut(auth);
  showToast('Sampai jumpa!', 'info');
};

// ══════════════════════════════════════
//  LOAD CURRENT USER
// ══════════════════════════════════════
async function loadCurrentUserData() {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  if (snap.exists()) {
    currentUserData = snap.data();
    updateUIWithUser();
  }
}

function updateUIWithUser() {
  const u = currentUserData;
  if (!u) return;

  const avatar = u.photoURL || DEFAULT_AVATAR(u.displayName);
  const name   = u.displayName || 'User';
  const uname  = '@' + (u.username || 'user');

  // Nav
  setImg('navAvatar', avatar);
  setImg('pmAvatar', avatar);
  setText('pmName', name);
  setText('pmUsername', uname);

  // Sidebar left
  setImg('sbAvatar', avatar);
  setText('sbName', name);
  setText('sbUsername', uname);

  // Create post
  setImg('cpAvatar', avatar);
  setText('cpPlaceholder', `Halo ${u.firstName || name}, apa yang ada di pikiranmu?`);

  // Modal
  setImg('modalAvatar', avatar);
  setText('modalName', name);

  // Comment
  setImg('commentAvatar', avatar);

  // Profile
  setImg('profileAvatar', avatar);
  setImg('epAvatar', avatar);
  setText('profileName', name);
  setText('profileUsername', uname);
  setText('profileBio', u.bio || '');
  setText('statFollowers', (u.followers || []).length);
  setText('statFollowing', (u.following || []).length);
  setText('statPosts', u.postCount || 0);
}

// ══════════════════════════════════════
//  SHOW/HIDE APP vs AUTH
// ══════════════════════════════════════
function showApp() {
  document.getElementById('authOverlay').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  lucide.createIcons();
}

function showAuth() {
  document.getElementById('authOverlay').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
  lucide.createIcons();
}

// ══════════════════════════════════════
//  SECTION ROUTING
// ══════════════════════════════════════
window.showSection = (section) => {
  // Hide all
  document.querySelectorAll('.section').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });

  // Update nav tabs
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  const map = {
    feed:    { section: 'sectionFeed',    tab: 'navFeed' },
    friends: { section: 'sectionFriends', tab: 'navFriends' },
    chat:    { section: 'sectionChat',    tab: 'navChat' },
    notif:   { section: 'sectionNotif',   tab: 'navNotif' },
    profile: { section: 'sectionProfile', tab: null }
  };

  const target = map[section];
  if (!target) return;

  const el = document.getElementById(target.section);
  el.classList.remove('hidden');
  el.classList.add('active');

  if (target.tab) document.getElementById(target.tab)?.classList.add('active');

  activeSection = section;
  lucide.createIcons();

  if (section === 'profile') loadProfilePosts();
  if (section === 'friends') loadAllUsers();
  if (section === 'notif')   markNotificationsRead();
};

// ══════════════════════════════════════
//  FEED
// ══════════════════════════════════════
async function initFeed() {
  feedLastDoc   = null;
  feedLoading   = false;
  feedExhausted = false;
  document.getElementById('feedContainer').innerHTML = `
    <div class="feed-loading">
      <div class="skeleton-card"><div class="sk-header"></div><div class="sk-line"></div><div class="sk-line short"></div><div class="sk-img"></div></div>
      <div class="skeleton-card"><div class="sk-header"></div><div class="sk-line"></div><div class="sk-line short"></div></div>
    </div>`;
  document.getElementById('feedEnd').classList.add('hidden');
  await loadMorePosts(true);
}

async function loadMorePosts(initial = false) {
  if (feedLoading || feedExhausted) return;
  feedLoading = true;

  try {
    let q;
    const base = query(
      collection(db, 'posts'),
      where('privacy', '!=', 'private'),
      orderBy('privacy'),
      orderBy('createdAt', 'desc'),
      limit(FEED_BATCH)
    );

    if (feedLastDoc) {
      q = query(
        collection(db, 'posts'),
        where('privacy', '!=', 'private'),
        orderBy('privacy'),
        orderBy('createdAt', 'desc'),
        startAfter(feedLastDoc),
        limit(FEED_BATCH)
      );
    } else {
      q = base;
    }

    const snap = await getDocs(q);

    if (initial) {
      document.getElementById('feedContainer').innerHTML = '';
    }

    if (snap.empty && initial) {
      document.getElementById('feedContainer').innerHTML = `
        <div class="card" style="padding:40px;text-align:center;color:var(--text-muted);">
          <p style="font-size:18px;">✨ Jadilah yang pertama posting!</p>
          <p style="margin-top:8px;font-size:14px;">Belum ada postingan. Buat postingan pertama kamu.</p>
        </div>`;
    } else {
      snap.forEach(docSnap => {
        renderPost(docSnap.id, docSnap.data());
      });
      feedLastDoc = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < FEED_BATCH) {
        feedExhausted = true;
        document.getElementById('feedEnd').classList.remove('hidden');
      }
    }
  } catch (err) {
    console.error('Feed error:', err);
    if (initial) {
      document.getElementById('feedContainer').innerHTML = `
        <div class="card" style="padding:24px;text-align:center;">
          <p style="color:var(--danger)">Gagal memuat feed. Cek koneksi internet.</p>
        </div>`;
    }
  } finally {
    feedLoading = false;
  }
}

function handleInfiniteScroll() {
  if (activeSection !== 'feed') return;
  const scrolled = window.innerHeight + window.scrollY;
  const height   = document.body.offsetHeight;
  if (scrolled >= height - 400) loadMorePosts();
}

// ══════════════════════════════════════
//  RENDER POST
// ══════════════════════════════════════
function renderPost(postId, data, container = null) {
  const liked = currentUser && (data.likes || []).includes(currentUser.uid);
  const timeAgo = formatTime(data.createdAt);
  const avatar  = data.authorPhoto || DEFAULT_AVATAR(data.authorName || 'U');
  const isLarge = !data.imageURL && (data.text || '').length < 80;

  const card = document.createElement('div');
  card.className = 'post-card';
  card.id = `post-${postId}`;

  card.innerHTML = `
    <div class="post-header">
      <img src="${avatar}" class="post-avatar" alt="" onclick="viewUserProfile('${data.authorId}')" />
      <div class="post-header-info">
        <p class="post-author" onclick="viewUserProfile('${data.authorId}')">${esc(data.authorName || 'Pengguna')}</p>
        <p class="post-meta">
          <i data-lucide="${data.privacy === 'friends' ? 'users' : 'globe'}"></i>
          ${timeAgo}
        </p>
      </div>
      ${currentUser && data.authorId === currentUser.uid ? `
        <button class="post-more" onclick="deletePost('${postId}')">
          <i data-lucide="trash-2"></i>
        </button>` : `
        <button class="post-more" onclick="">
          <i data-lucide="more-horizontal"></i>
        </button>`}
    </div>

    ${data.text ? `<div class="post-content">
      <p class="post-text ${isLarge ? 'large' : ''}">${esc(data.text)}</p>
    </div>` : ''}

    ${data.imageURL ? `<img src="${data.imageURL}" class="post-image" alt="Post image"
      onclick="openLightbox('${data.imageURL}')" loading="lazy" />` : ''}

    <div class="post-stats" id="stats-${postId}">
      <div class="post-stats-left">
        <span class="like-emoji">👍</span>
        <span id="likeCount-${postId}">${(data.likes || []).length}</span>
      </div>
      <span id="commentCount-${postId}">${data.commentCount || 0} komentar</span>
    </div>

    <div class="post-actions">
      <button class="post-action-btn ${liked ? 'liked' : ''}" id="likeBtn-${postId}"
        onclick="toggleLike('${postId}')">
        <i data-lucide="thumbs-up"></i>
        <span>Suka</span>
      </button>
      <button class="post-action-btn" onclick="openComments('${postId}')">
        <i data-lucide="message-square"></i>
        <span>Komentar</span>
      </button>
      <button class="post-action-btn" onclick="sharePost('${postId}')">
        <i data-lucide="share-2"></i>
        <span>Bagikan</span>
      </button>
    </div>`;

  const target = container || document.getElementById('feedContainer');
  target.appendChild(card);
  lucide.createIcons();
}

// ══════════════════════════════════════
//  LIKE
// ══════════════════════════════════════
window.toggleLike = async (postId) => {
  if (!currentUser) return showToast('Login dulu', 'error');

  const postRef = doc(db, 'posts', postId);
  const snap    = await getDoc(postRef);
  if (!snap.exists()) return;

  const data   = snap.data();
  const likes  = data.likes || [];
  const liked  = likes.includes(currentUser.uid);
  const btn    = document.getElementById(`likeBtn-${postId}`);
  const count  = document.getElementById(`likeCount-${postId}`);

  if (liked) {
    await updateDoc(postRef, { likes: arrayRemove(currentUser.uid) });
    btn.classList.remove('liked');
    count.textContent = Math.max(0, parseInt(count.textContent) - 1);
  } else {
    await updateDoc(postRef, { likes: arrayUnion(currentUser.uid) });
    btn.classList.add('liked');
    count.textContent = parseInt(count.textContent) + 1;

    // Send notification to author
    if (data.authorId !== currentUser.uid) {
      await addNotification(data.authorId, {
        type: 'like',
        fromId: currentUser.uid,
        fromName: currentUserData?.displayName,
        fromPhoto: currentUserData?.photoURL,
        postId,
        text: `menyukai postingan kamu`
      });
    }
  }
};

// ══════════════════════════════════════
//  COMMENTS
// ══════════════════════════════════════
window.openComments = async (postId) => {
  currentCommentPostId = postId;
  document.getElementById('commentsList').innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)"><div class="spinner-sm" style="border-color:var(--border);border-top-color:var(--brand);margin:auto"></div></div>`;
  openModal('commentModal');

  const snap = await getDocs(query(
    collection(db, `posts/${postId}/comments`),
    orderBy('createdAt', 'asc')
  ));

  const list = document.getElementById('commentsList');
  list.innerHTML = '';

  if (snap.empty) {
    list.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted);font-size:14px">Belum ada komentar. Jadilah yang pertama!</p>';
  } else {
    snap.forEach(c => renderComment(c.data(), list));
    lucide.createIcons();
  }
};

function renderComment(data, container) {
  const div = document.createElement('div');
  div.className = 'comment-item';
  div.innerHTML = `
    <img src="${data.authorPhoto || DEFAULT_AVATAR(data.authorName)}" class="comment-avatar" alt="" />
    <div class="comment-bubble">
      <p class="c-name">${esc(data.authorName || 'Pengguna')}</p>
      <p class="c-text">${esc(data.text)}</p>
      <p class="c-time">${formatTime(data.createdAt)}</p>
    </div>`;
  container.appendChild(div);
}

window.submitComment = async () => {
  const input = document.getElementById('commentInput');
  const text  = input.value.trim();
  if (!text || !currentCommentPostId) return;
  if (!currentUser) return showToast('Login dulu', 'error');

  const data = {
    text,
    authorId:    currentUser.uid,
    authorName:  currentUserData?.displayName,
    authorPhoto: currentUserData?.photoURL,
    createdAt:   serverTimestamp()
  };

  await addDoc(collection(db, `posts/${currentCommentPostId}/comments`), data);

  // Update comment count
  await updateDoc(doc(db, 'posts', currentCommentPostId), {
    commentCount: increment(1)
  });

  // Update UI
  const count = document.getElementById(`commentCount-${currentCommentPostId}`);
  if (count) {
    const cur = parseInt(count.textContent) || 0;
    count.textContent = `${cur + 1} komentar`;
  }

  // Render in modal
  const list = document.getElementById('commentsList');
  const p = list.querySelector('p');
  if (p && p.textContent.includes('Belum ada')) list.innerHTML = '';
  renderComment({ ...data, createdAt: null }, list);

  input.value = '';

  // Notify post author
  const postSnap = await getDoc(doc(db, 'posts', currentCommentPostId));
  if (postSnap.exists() && postSnap.data().authorId !== currentUser.uid) {
    await addNotification(postSnap.data().authorId, {
      type: 'comment',
      fromId: currentUser.uid,
      fromName: currentUserData?.displayName,
      fromPhoto: currentUserData?.photoURL,
      postId: currentCommentPostId,
      text: 'mengomentari postingan kamu'
    });
  }
};

// ══════════════════════════════════════
//  CREATE POST
// ══════════════════════════════════════
window.openPostModal = (type) => {
  openModal('postModal');
  if (type === 'image') {
    document.getElementById('postImageInput').click();
  }
  lucide.createIcons();
};

window.previewPostImage = (input) => {
  if (!input.files[0]) return;
  postImageFile = input.files[0];
  const url = URL.createObjectURL(postImageFile);
  document.getElementById('previewImg').src = url;
  document.getElementById('postImagePreview').classList.remove('hidden');
};

window.removePostImage = () => {
  postImageFile = null;
  document.getElementById('postImagePreview').classList.add('hidden');
  document.getElementById('postImageInput').value = '';
};

// Live char count
document.addEventListener('input', e => {
  if (e.target.id === 'postText') {
    document.getElementById('charCount').textContent = `${e.target.value.length}/1000`;
  }
});

window.submitPost = async () => {
  const text    = document.getElementById('postText').value.trim();
  const privacy = document.getElementById('postPrivacy').value;

  if (!text && !postImageFile) return showToast('Tulis sesuatu atau pilih gambar', 'error');
  if (!currentUser) return showToast('Login dulu', 'error');

  const btn = document.querySelector('#postModal .btn-primary');
  setLoading(btn, true);

  try {
    let imageURL = null;

    if (postImageFile) {
      imageURL = await uploadFile(
        postImageFile,
        `posts/${currentUser.uid}/${Date.now()}_${postImageFile.name}`
      );
    }

    const postData = {
      text,
      imageURL,
      privacy,
      authorId:    currentUser.uid,
      authorName:  currentUserData?.displayName,
      authorPhoto: currentUserData?.photoURL,
      authorUsername: currentUserData?.username,
      likes:       [],
      commentCount: 0,
      createdAt:   serverTimestamp()
    };

    const ref = await addDoc(collection(db, 'posts'), postData);

    // Update user post count
    await updateDoc(doc(db, 'users', currentUser.uid), {
      postCount: increment(1)
    });
    if (currentUserData) currentUserData.postCount = (currentUserData.postCount || 0) + 1;
    setText('statPosts', currentUserData?.postCount || 0);

    // Prepend to feed
    const container = document.getElementById('feedContainer');
    const tempData  = { ...postData, createdAt: null };

    const tempDiv = document.createElement('div');
    container.insertBefore(tempDiv, container.firstChild);
    tempDiv.remove();

    renderPost(ref.id, { ...tempData, createdAt: { seconds: Date.now() / 1000 } });
    const newCard = document.getElementById(`post-${ref.id}`);
    if (newCard) {
      const first = container.firstChild;
      container.insertBefore(newCard, first);
    }

    // Reset
    document.getElementById('postText').value = '';
    document.getElementById('charCount').textContent = '0/1000';
    postImageFile = null;
    document.getElementById('postImagePreview').classList.add('hidden');
    document.getElementById('postImageInput').value = '';

    closeModal('postModal');
    showToast('Postingan berhasil diunggah!', 'success');

  } catch (err) {
    console.error(err);
    showToast('Gagal membuat postingan', 'error');
  } finally {
    setLoading(btn, false);
  }
};

// ══════════════════════════════════════
//  DELETE POST
// ══════════════════════════════════════
window.deletePost = async (postId) => {
  if (!confirm('Hapus postingan ini?')) return;
  try {
    await deleteDoc(doc(db, 'posts', postId));
    document.getElementById(`post-${postId}`)?.remove();
    await updateDoc(doc(db, 'users', currentUser.uid), { postCount: increment(-1) });
    showToast('Postingan dihapus', 'info');
  } catch (err) {
    showToast('Gagal menghapus', 'error');
  }
};

// Share post
window.sharePost = (postId) => {
  const url = `${window.location.href}#post-${postId}`;
  navigator.clipboard.writeText(url).then(() => showToast('Link disalin!', 'success'));
};

// ══════════════════════════════════════
//  PROFILE AVATAR UPLOAD
// ══════════════════════════════════════
window.uploadAvatar = async (input) => {
  if (!input.files[0]) return;
  const file = input.files[0];
  showToast('Mengupload foto…', 'info');

  try {
    const url = await uploadFile(file, `avatars/${currentUser.uid}/profile.jpg`);

    await updateProfile(auth.currentUser, { photoURL: url });
    await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: url });

    if (currentUserData) currentUserData.photoURL = url;
    updateUIWithUser();
    setImg('epAvatar', url);

    showToast('Foto profil diperbarui!', 'success');
  } catch (err) {
    showToast('Gagal upload foto', 'error');
  }
};

// ══════════════════════════════════════
//  EDIT PROFILE
// ══════════════════════════════════════
window.openEditProfile = () => {
  const u = currentUserData;
  if (!u) return;
  document.getElementById('epFirstName').value = u.firstName || '';
  document.getElementById('epLastName').value  = u.lastName  || '';
  document.getElementById('epBio').value       = u.bio       || '';
  document.getElementById('epLocation').value  = u.location  || '';
  openModal('editProfileModal');
};

window.saveProfile = async () => {
  const firstName = document.getElementById('epFirstName').value.trim();
  const lastName  = document.getElementById('epLastName').value.trim();
  const bio       = document.getElementById('epBio').value.trim();
  const location  = document.getElementById('epLocation').value.trim();

  if (!firstName || !lastName) return showToast('Nama tidak boleh kosong', 'error');

  const btn = document.querySelector('#editProfileModal .btn-primary');
  setLoading(btn, true);

  try {
    const displayName = `${firstName} ${lastName}`;
    await updateDoc(doc(db, 'users', currentUser.uid), {
      firstName, lastName, displayName, bio, location
    });
    await updateProfile(auth.currentUser, { displayName });

    currentUserData = { ...currentUserData, firstName, lastName, displayName, bio, location };
    updateUIWithUser();

    closeModal('editProfileModal');
    showToast('Profil berhasil diperbarui!', 'success');
  } catch (err) {
    showToast('Gagal simpan profil', 'error');
  } finally {
    setLoading(btn, false);
  }
};

// ══════════════════════════════════════
//  PROFILE POSTS
// ══════════════════════════════════════
async function loadProfilePosts() {
  if (!currentUser) return;
  const container = document.getElementById('profilePosts');
  container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)"><div class="spinner-sm" style="border-color:var(--border);border-top-color:var(--brand);margin:auto"></div></div>';

  const q = query(
    collection(db, 'posts'),
    where('authorId', '==', currentUser.uid),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  const snap = await getDocs(q);
  container.innerHTML = '';

  if (snap.empty) {
    container.innerHTML = '<div class="card" style="padding:32px;text-align:center;color:var(--text-muted)">Belum ada postingan. Buat postingan pertama kamu!</div>';
  } else {
    snap.forEach(d => renderPost(d.id, d.data(), container));
    lucide.createIcons();
  }
}

// ══════════════════════════════════════
//  SUGGESTED / ALL USERS
// ══════════════════════════════════════
async function loadSuggestedUsers() {
  const container = document.getElementById('suggestedUsers');
  const snap = await getDocs(query(collection(db, 'users'), limit(5)));

  container.innerHTML = '';
  snap.forEach(d => {
    const u = d.data();
    if (u.uid === currentUser?.uid) return;
    const following = (currentUserData?.following || []).includes(u.uid);
    const el = document.createElement('div');
    el.className = 'suggested-user';
    el.innerHTML = `
      <img src="${u.photoURL || DEFAULT_AVATAR(u.displayName)}" class="su-avatar" alt="" />
      <div class="su-info">
        <p class="su-name">${esc(u.displayName || 'Pengguna')}</p>
        <p class="su-mutual">@${u.username || 'user'}</p>
      </div>
      <button class="su-follow-btn ${following ? 'following' : ''}" id="sfBtn-${u.uid}"
        onclick="toggleFollow('${u.uid}', 'sfBtn-${u.uid}')">
        ${following ? 'Mengikuti' : 'Ikuti'}
      </button>`;
    container.appendChild(el);
  });
  lucide.createIcons();
}

async function loadAllUsers() {
  const container = document.getElementById('allUsersList');
  container.innerHTML = '';
  const snap = await getDocs(query(collection(db, 'users'), limit(40)));

  allUsersCache = [];
  snap.forEach(d => {
    const u = d.data();
    allUsersCache.push(u);
    if (u.uid === currentUser?.uid) return;
    renderUserCard(u, container);
  });
  lucide.createIcons();
}

function renderUserCard(u, container) {
  const following = (currentUserData?.following || []).includes(u.uid);
  const card = document.createElement('div');
  card.className = 'user-card';
  card.innerHTML = `
    <img src="${u.photoURL || DEFAULT_AVATAR(u.displayName)}" class="uc-avatar" alt="" />
    <p class="uc-name">${esc(u.displayName || 'Pengguna')}</p>
    <p class="uc-uname">@${u.username || 'user'}</p>
    <p style="font-size:12px;color:var(--text-muted)">${(u.followers || []).length} pengikut</p>
    <button class="uc-follow-btn ${following ? 'following' : ''}" id="ucBtn-${u.uid}"
      onclick="toggleFollow('${u.uid}', 'ucBtn-${u.uid}')">
      ${following ? '✓ Mengikuti' : '+ Ikuti'}
    </button>
    <button class="uc-chat-btn" onclick="startChat('${u.uid}')">
      <i data-lucide="message-circle" style="width:14px;height:14px;vertical-align:middle"></i> Chat
    </button>`;
  container.appendChild(card);
}

// ══════════════════════════════════════
//  FOLLOW / UNFOLLOW
// ══════════════════════════════════════
window.toggleFollow = async (targetUid, btnId) => {
  if (!currentUser || !currentUserData) return;

  const following = (currentUserData.following || []).includes(targetUid);
  const btn = document.getElementById(btnId);

  if (following) {
    await updateDoc(doc(db, 'users', currentUser.uid), { following: arrayRemove(targetUid) });
    await updateDoc(doc(db, 'users', targetUid),      { followers: arrayRemove(currentUser.uid) });
    currentUserData.following = currentUserData.following.filter(id => id !== targetUid);
    if (btn) { btn.textContent = 'Ikuti'; btn.classList.remove('following'); }
    showToast('Berhenti mengikuti', 'info');
  } else {
    await updateDoc(doc(db, 'users', currentUser.uid), { following: arrayUnion(targetUid) });
    await updateDoc(doc(db, 'users', targetUid),      { followers: arrayUnion(currentUser.uid) });
    currentUserData.following.push(targetUid);
    if (btn) { btn.textContent = 'Mengikuti'; btn.classList.add('following'); }
    showToast('Mengikuti pengguna', 'success');

    await addNotification(targetUid, {
      type: 'follow',
      fromId: currentUser.uid,
      fromName: currentUserData.displayName,
      fromPhoto: currentUserData.photoURL,
      text: 'mulai mengikuti kamu'
    });
  }

  setText('statFollowing', (currentUserData.following || []).length);
  loadSuggestedUsers();
};

// ══════════════════════════════════════
//  ONLINE FRIENDS (Sidebar)
// ══════════════════════════════════════
async function loadOnlineFriends() {
  const container = document.getElementById('onlineFriends');
  if (!currentUserData?.following?.length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Belum mengikuti siapapun</p>';
    return;
  }
  const ids = currentUserData.following.slice(0, 8);
  container.innerHTML = '';
  for (const uid of ids) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) continue;
    const u = snap.data();
    const el = document.createElement('div');
    el.className = 'online-user';
    el.onclick = () => startChat(uid);
    el.innerHTML = `
      <div class="online-wrap">
        <img src="${u.photoURL || DEFAULT_AVATAR(u.displayName)}" alt="" />
        <div class="online-dot"></div>
      </div>
      <p class="online-name">${esc(u.displayName)}</p>`;
    container.appendChild(el);
  }
}

// ══════════════════════════════════════
//  CHAT
// ══════════════════════════════════════
async function loadChatList() {
  const container = document.getElementById('chatList');
  if (!currentUserData?.following?.length) {
    container.innerHTML = '<p style="padding:16px;font-size:13px;color:var(--text-muted)">Ikuti pengguna untuk mulai chat</p>';
    return;
  }

  container.innerHTML = '';
  const ids = currentUserData.following.slice(0, 20);
  for (const uid of ids) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) continue;
    const u = snap.data();
    const el = document.createElement('div');
    el.className = 'chat-item';
    el.id = `chatItem-${uid}`;
    el.onclick = () => openChat(uid, u);
    el.innerHTML = `
      <div class="chat-item-avatar">
        <img src="${u.photoURL || DEFAULT_AVATAR(u.displayName)}" alt="" />
        <div class="online-dot"></div>
      </div>
      <div class="chat-item-info">
        <p class="chat-item-name">${esc(u.displayName)}</p>
        <p class="chat-item-last">Klik untuk memulai chat</p>
      </div>
      <span class="chat-item-time"></span>`;
    container.appendChild(el);
  }
}

window.startChat = (uid) => {
  showSection('chat');
  getDoc(doc(db, 'users', uid)).then(snap => {
    if (snap.exists()) openChat(uid, snap.data());
  });
};

function openChat(uid, userData) {
  if (chatUnsubscribe) chatUnsubscribe();
  activeChatUserId = uid;

  // Mark active
  document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`chatItem-${uid}`)?.classList.add('active');

  const chatMain = document.getElementById('chatMain');
  chatMain.innerHTML = `
    <div class="chat-header">
      <img src="${userData.photoURL || DEFAULT_AVATAR(userData.displayName)}" alt="" />
      <div class="chat-header-info">
        <p class="chat-header-name">${esc(userData.displayName)}</p>
        <p class="chat-status">● Online</p>
      </div>
    </div>
    <div class="messages-container" id="messagesContainer"></div>
    <div class="chat-input-bar">
      <input type="text" id="chatInput" placeholder="Ketik pesan…"
        onkeydown="if(event.key==='Enter')sendMessage('${uid}')" />
      <button class="send-btn" onclick="sendMessage('${uid}')">
        <i data-lucide="send"></i>
      </button>
    </div>`;
  lucide.createIcons();

  // Real-time listener
  const chatId = getChatId(currentUser.uid, uid);
  const q = query(
    collection(db, `chats/${chatId}/messages`),
    orderBy('createdAt', 'asc'),
    limit(50)
  );

  chatUnsubscribe = onSnapshot(q, snap => {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    container.innerHTML = '';
    snap.forEach(d => renderMessage(d.data(), container));
    container.scrollTop = container.scrollHeight;
  });
}

function renderMessage(data, container) {
  const isMine = data.senderId === currentUser.uid;
  const group  = document.createElement('div');
  group.className = `msg-group ${isMine ? 'mine' : 'theirs'}`;
  group.innerHTML = `
    <div class="msg-bubble">${esc(data.text)}</div>
    <p class="msg-time">${formatTime(data.createdAt)}</p>`;
  container.appendChild(group);
}

window.sendMessage = async (toUid) => {
  const input = document.getElementById('chatInput');
  const text  = input?.value.trim();
  if (!text) return;
  input.value = '';

  const chatId = getChatId(currentUser.uid, toUid);
  await addDoc(collection(db, `chats/${chatId}/messages`), {
    text,
    senderId:   currentUser.uid,
    receiverId: toUid,
    createdAt:  serverTimestamp()
  });
};

function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

window.filterChats = (val) => {
  document.querySelectorAll('.chat-item').forEach(item => {
    const name = item.querySelector('.chat-item-name').textContent.toLowerCase();
    item.style.display = name.includes(val.toLowerCase()) ? '' : 'none';
  });
};

// ══════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════
async function initNotifications() {
  const q = query(
    collection(db, `notifications/${currentUser.uid}/items`),
    orderBy('createdAt', 'desc'),
    limit(30)
  );

  notifUnsubscribe = onSnapshot(q, snap => {
    const unread = snap.docs.filter(d => !d.data().read).length;
    const badge  = document.getElementById('notifBadge');
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    renderNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

function renderNotifications(notifs) {
  const container = document.getElementById('notifList');
  container.innerHTML = '';

  if (!notifs.length) {
    container.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted)">Belum ada notifikasi</p>';
    return;
  }

  const iconMap = { like: '👍', comment: '💬', follow: '👥' };

  notifs.forEach(n => {
    const el = document.createElement('div');
    el.className = `notif-item ${n.read ? '' : 'unread'}`;
    el.innerHTML = `
      <div class="notif-avatar">
        <img src="${n.fromPhoto || DEFAULT_AVATAR(n.fromName || 'U')}" alt="" />
        <div class="notif-icon ${n.type}">${iconMap[n.type] || '🔔'}</div>
      </div>
      <div class="notif-text">
        <p><strong>${esc(n.fromName || 'Seseorang')}</strong> ${esc(n.text)}</p>
        <p class="notif-time">${formatTime(n.createdAt)}</p>
      </div>
      ${!n.read ? '<div class="notif-dot"></div>' : ''}`;
    container.appendChild(el);
  });
}

async function addNotification(toUid, data) {
  await addDoc(collection(db, `notifications/${toUid}/items`), {
    ...data, read: false, createdAt: serverTimestamp()
  });
}

async function markNotificationsRead() {
  if (!currentUser) return;
  const q = query(
    collection(db, `notifications/${currentUser.uid}/items`),
    where('read', '==', false)
  );
  const snap = await getDocs(q);
  snap.forEach(d => updateDoc(d.ref, { read: true }));
}

// ══════════════════════════════════════
//  SEARCH
// ══════════════════════════════════════
window.handleSearch = async (val) => {
  const dropdown = document.getElementById('searchResults');
  if (!val.trim()) { dropdown.classList.add('hidden'); return; }

  const results = allUsersCache.filter(u =>
    u.uid !== currentUser?.uid &&
    (u.displayName?.toLowerCase().includes(val.toLowerCase()) ||
     u.username?.toLowerCase().includes(val.toLowerCase()))
  ).slice(0, 6);

  dropdown.innerHTML = '';
  if (!results.length) {
    dropdown.innerHTML = '<p style="padding:12px 14px;font-size:13px;color:var(--text-muted)">Pengguna tidak ditemukan</p>';
  } else {
    results.forEach(u => {
      const el = document.createElement('div');
      el.className = 'search-item';
      el.onclick = () => {
        dropdown.classList.add('hidden');
        document.getElementById('searchInput').value = '';
      };
      el.innerHTML = `
        <img src="${u.photoURL || DEFAULT_AVATAR(u.displayName)}" alt="" />
        <div class="si-info">
          <p>${esc(u.displayName)}</p>
          <span>@${u.username}</span>
        </div>`;
      dropdown.appendChild(el);
    });
  }
  dropdown.classList.remove('hidden');
};

// Close search on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.search-bar')) {
    document.getElementById('searchResults')?.classList.add('hidden');
  }
  if (!e.target.closest('.nav-avatar-wrap')) {
    document.getElementById('profileMenu')?.classList.add('hidden');
  }
});

// ══════════════════════════════════════
//  VIEW USER PROFILE
// ══════════════════════════════════════
window.viewUserProfile = (uid) => {
  if (uid === currentUser?.uid) { showSection('profile'); return; }
  // For simplicity, show their posts in a toast (extend as needed)
  showToast('Melihat profil pengguna…', 'info');
};

// ══════════════════════════════════════
//  DARK MODE
// ══════════════════════════════════════
window.toggleDark = () => {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  const icon = document.getElementById('darkIcon');
  icon.setAttribute('data-lucide', isDark ? 'moon' : 'sun');
  lucide.createIcons();
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
};

// Restore theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

// ══════════════════════════════════════
//  MODALS
// ══════════════════════════════════════
function openModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  lucide.createIcons();
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}
window.closeModal = closeModal;
window.openModal  = openModal;

window.closeModalOutside = (e, id) => {
  if (e.target.classList.contains('modal-overlay')) closeModal(id);
};

// ══════════════════════════════════════
//  LIGHTBOX
// ══════════════════════════════════════
window.openLightbox = (src) => {
  document.getElementById('lbImg').src = src;
  document.getElementById('lightbox').classList.remove('hidden');
};
window.closeLightbox = () => {
  document.getElementById('lightbox').classList.add('hidden');
};

// ══════════════════════════════════════
//  PROFILE MENU TOGGLE
// ══════════════════════════════════════
window.toggleProfileMenu = () => {
  document.getElementById('profileMenu')?.classList.toggle('hidden');
  lucide.createIcons();
};

// ══════════════════════════════════════
//  TOGGLE PASSWORD VISIBILITY
// ══════════════════════════════════════
window.togglePass = (inputId) => {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
};

// ══════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════

// Upload file to Firebase Storage
async function uploadFile(file, path) {
  const storageRef = ref(storage, path);
  const task       = uploadBytesResumable(storageRef, file);
  return new Promise((resolve, reject) => {
    task.on('state_changed', null, reject, async () => {
      const url = await getDownloadURL(task.snapshot.ref);
      resolve(url);
    });
  });
}

// Format timestamp
function formatTime(ts) {
  if (!ts) return 'Baru saja';
  const date = ts?.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const now  = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60)    return 'Baru saja';
  if (diff < 3600)  return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Escape HTML
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Set image src
function setImg(id, src) {
  const el = document.getElementById(id);
  if (el) el.src = src;
}

// Set text content
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// Button loading state
function setLoading(btn, loading) {
  const span   = btn.querySelector('span');
  const loader = btn.querySelector('.btn-loader');
  if (loading) {
    btn.disabled = true;
    span?.classList.add('hidden');
    loader?.classList.remove('hidden');
  } else {
    btn.disabled = false;
    span?.classList.remove('hidden');
    loader?.classList.add('hidden');
  }
}

// Toast notification
window.showToast = (message, type = 'info', title = null) => {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const titles = { success: 'Berhasil', error: 'Error', info: 'Info', warning: 'Peringatan' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-text">
      <p>${title || titles[type]}</p>
      <span>${message}</span>
    </div>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

// Firebase error messages (Indonesian)
function firebaseError(code) {
  const map = {
    'auth/email-already-in-use':    'Email sudah terdaftar',
    'auth/invalid-email':           'Format email tidak valid',
    'auth/weak-password':           'Password terlalu lemah',
    'auth/user-not-found':          'Email tidak terdaftar',
    'auth/wrong-password':          'Password salah',
    'auth/invalid-credential':      'Email atau password salah',
    'auth/too-many-requests':       'Terlalu banyak percobaan, coba lagi nanti',
    'auth/network-request-failed':  'Koneksi internet bermasalah',
    'auth/user-disabled':           'Akun ini dinonaktifkan',
  };
  return map[code] || `Terjadi kesalahan: ${code}`;
}

