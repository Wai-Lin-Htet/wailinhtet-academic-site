import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  addDoc, getDocs, query, where, serverTimestamp, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, firebaseReady } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.portalPage;
const status = (message, isError = false) => {
  const element = $('status');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('portal-error', isError);
};
const safeText = (element, value) => {
  if (element) element.textContent = String(value ?? '');
};
const errorMessage = (error) => {
  if (error?.code === 'permission-denied') {
    return 'Missing or insufficient permissions. Check the published Firestore Rules and your account approval.';
  }
  if (error?.code === 'unavailable') return 'Firebase is temporarily unavailable. Please try again.';
  return error?.message || 'An unexpected error occurred.';
};

if (!firebaseReady) {
  status('Firebase is not configured. Check assets/portal/firebase-config.js.', true);
  if ($('google-login')) $('google-login').disabled = true;
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const loginButton = $('google-login');
  if (loginButton) {
    loginButton.addEventListener('click', async () => {
      loginButton.disabled = true;
      status('Signing in with Google…');
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
          try {
            await signInWithRedirect(auth, provider);
            return;
          } catch (redirectError) {
            status('Sign-in failed: ' + errorMessage(redirectError), true);
          }
        } else if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
          status('Sign-in failed: ' + errorMessage(error), true);
        } else {
          status('Sign-in cancelled. You can try again.');
        }
      } finally {
        loginButton.disabled = false;
      }
    });
  }

  getRedirectResult(auth).catch((error) => {
    status('Sign-in redirect failed: ' + errorMessage(error), true);
  });

  const logoutButton = $('logout');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await signOut(auth);
        location.assign('login.html');
      } catch (error) {
        status('Sign-out failed: ' + errorMessage(error), true);
      }
    });
  }

  // This requires the published Firestore rule:
  // match /admins/{uid} {
  //   allow get: if request.auth != null && request.auth.uid == uid;
  //   allow list, write: if false;
  // }
  // An admin document must be created using the Firebase Console or a trusted backend.
  const isAdmin = async (uid) => {
    try {
      const snapshot = await getDoc(doc(db, 'admins', uid));
      return snapshot.exists();
    } catch (error) {
      // A permission denial must never grant admin privileges.
      if (error.code === 'permission-denied') {
        console.warn('Admin check denied. Verify published /admins/{uid} rules.', error);
        return false;
      }
      throw error;
    }
  };

  const profile = async (user) => {
    const ref = doc(db, 'users', user.uid);
    const snapshot = await getDoc(ref);
    if (snapshot.exists()) return snapshot.data();

    const data = {
      displayName: user.displayName || '',
      email: user.email || '',
      approved: false,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    };
    await setDoc(ref, data);
    return {
      displayName: user.displayName || '',
      email: user.email || '',
      approved: false
    };
  };

  const logLogin = async (user) => {
    const key = 'wlh-login-logged:' + user.uid;
    if (sessionStorage.getItem(key)) return;
    await addDoc(collection(db, 'loginEvents'), {
      uid: user.uid,
      at: serverTimestamp()
    });
    sessionStorage.setItem(key, '1');
  };

  const logView = async (user, courseId) => {
    if (!courseId) return;
    await addDoc(collection(db, 'lessonViews'), {
      uid: user.uid,
      courseId: String(courseId).slice(0, 120),
      at: serverTimestamp()
    });
  };

  const validResourceUrl = (value) => {
    if (typeof value !== 'string') return false;
    if (/^https:\/\/[^\s]+$/i.test(value)) return true;
    return /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_./-]+\.html(?:#[a-zA-Z0-9_-]+)?$/.test(value);
  };

  const showCourses = async (user) => {
    const list = $('courses-list');
    if (!list) return;
    const snapshot = await getDocs(query(
      collection(db, 'enrollments'), where('uid', '==', user.uid)
    ));
    list.replaceChildren();
    if (snapshot.empty) {
      list.textContent = 'No courses assigned yet. Please contact your teacher.';
      return;
    }
    for (const record of snapshot.docs) {
      const data = record.data();
      const card = document.createElement('article');
      card.className = 'portal-panel';
      const title = document.createElement('h3');
      safeText(title, data.courseTitle || data.courseId || 'Course');
      card.append(title);
      const description = document.createElement('p');
      description.className = 'portal-muted';
      description.textContent = 'Approved course resource';
      card.append(description);
      if (validResourceUrl(data.resourceUrl)) {
        const link = document.createElement('a');
        link.className = 'portal-secondary';
        link.textContent = 'Open course resource';
        link.href = data.resourceUrl;
        link.rel = 'noopener noreferrer';
        link.addEventListener('click', () => {
          logView(user, data.courseId || 'unknown').catch((error) => {
            console.warn('Lesson view was not recorded:', error);
          });
        });
        card.append(link);
      }
      list.append(card);
    }
  };

  const showAdmin = async () => {
    const [users, logins, views] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(query(collection(db, 'loginEvents'), orderBy('at', 'desc'), limit(500))),
      getDocs(query(collection(db, 'lessonViews'), orderBy('at', 'desc'), limit(500)))
    ]);
    safeText($('student-count'), users.size);
    safeText($('login-count'), String(logins.size) + ' (latest 500 max)');
    safeText($('view-count'), String(views.size) + ' (latest 500 max)');

    const counts = {};
    for (const item of logins.docs) {
      const uid = item.data().uid;
      if (uid) counts[uid] = (counts[uid] || 0) + 1;
    }
    const tbody = $('student-rows');
    if (!tbody) return;
    tbody.replaceChildren();
    for (const item of users.docs) {
      const data = item.data();
      const row = document.createElement('tr');
      for (const value of [
        data.displayName || '—', data.email || '—',
        data.approved ? 'Approved' : 'Pending', counts[item.id] || 0
      ]) {
        const cell = document.createElement('td');
        safeText(cell, value);
        row.append(cell);
      }
      const actionCell = document.createElement('td');
      const button = document.createElement('button');
      button.className = 'portal-btn';
      button.textContent = data.approved ? 'Revoke' : 'Approve';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await updateDoc(doc(db, 'users', item.id), { approved: !data.approved });
          await showAdmin();
          status('Student approval updated.');
        } catch (error) {
          status('Approval update failed: ' + errorMessage(error), true);
          button.disabled = false;
        }
      });
      actionCell.append(button);
      row.append(actionCell);
      tbody.append(row);
    }
  };

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        if (page === 'login') {
          status('Sign in with your Google account to request access.');
          if (loginButton) loginButton.hidden = false;
          return;
        }
        location.replace('login.html');
        return;
      }

      status('Checking your account…');
      const admin = await isAdmin(user.uid);
      const account = await profile(user);
      // Analytics must not block sign-in or dashboard access.
      logLogin(user).catch((error) => {
        console.warn('Login event was not recorded:', error);
      });

      if (page === 'login') {
        if (admin) {
          location.replace('admin-dashboard.html');
        } else if (account.approved === true) {
          location.replace('student-dashboard.html');
        } else {
          status('Registration received. Your teacher must approve your account before course access is enabled.');
          if (loginButton) loginButton.hidden = true;
        }
      } else if (page === 'student') {
        if (!account.approved && !admin) {
          status('Your account is pending teacher approval.');
          return;
        }
        if ($('student-area')) $('student-area').hidden = false;
        safeText($('student-name'), account.displayName || user.email || 'Student');
        await showCourses(user);
        status('Signed in.');
      } else if (page === 'admin') {
        if (!admin) {
          status('Teacher access only. Your account does not have administrator permission.', true);
          return;
        }
        if ($('admin-area')) $('admin-area').hidden = false;
        await showAdmin();
        status('Teacher dashboard loaded.');
      }
    } catch (error) {
      console.error('Account loading failed:', error);
      status('Unable to load your account: ' + errorMessage(error), true);
    }
  });
}
