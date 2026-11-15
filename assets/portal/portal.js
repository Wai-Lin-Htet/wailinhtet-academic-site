import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  addDoc, deleteDoc, getDocs, query, where, serverTimestamp, orderBy, limit
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

  // Course catalogue for the admin Enroll panel — the 6 main courses.
  // resourceUrl is the page a student lands on from their dashboard.
  // 4CP0 has no course page yet, so it opens the Resources catalogue.
  const COURSES = [
    { courseId: 'ict-0417', courseTitle: 'ICT CIE 0417 — Exam Notebook', resourceUrl: 'ict-0417-course.html' },
    { courseId: 'cs-0478', courseTitle: 'Computer Science (0478) — IGCSE', resourceUrl: 'https://wai-lin-htet.github.io/CS_IGCSE/' },
    { courseId: 'ict-4it1', courseTitle: 'IGCSE ICT (4IT1) — Edexcel', resourceUrl: 'ict_edexcel_4it_v1.html' },
    { courseId: 'cs-4cp0', courseTitle: 'Computer Science (4CP0) — Edexcel IGCSE', resourceUrl: 'resources.html' },
    { courseId: 'cs-9618', courseTitle: 'A-Level Computer Science (9618)', resourceUrl: 'CS_9618_Alevel_wh.html' },
    { courseId: 'ict-cs-foundation', courseTitle: 'ICT / Computer Science Foundation', resourceUrl: 'ict-foundation.html' },
    { courseId: 'python-basics', courseTitle: 'Python Programming Basics', resourceUrl: 'python-basics.html' }
  ];

  // Admin enrollment panel: enroll a student, or update their entry point
  // if they already have the course. Rebuilt on every showAdmin() call.
  const renderEnroll = (users, enrollments) => {
    const studentSelect = $('enroll-student');
    const courseSelect = $('enroll-course');
    const enrollBtn = $('enroll-btn');
    const listBody = $('enrollment-rows');
    if (!studentSelect || !courseSelect || !enrollBtn || !listBody) return;

    const userById = {};
    users.forEach((item) => { userById[item.id] = item.data(); });

    // Student dropdown: approved students only (pending students cannot open courses yet).
    studentSelect.replaceChildren();
    const approved = users.docs.filter((item) => item.data().approved === true);
    if (approved.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No approved students yet';
      studentSelect.append(opt);
      studentSelect.disabled = true;
    } else {
      studentSelect.disabled = false;
      for (const item of approved) {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = (item.data().displayName || '—') + ' (' + (item.data().email || '—') + ')';
        studentSelect.append(opt);
      }
    }

    // Course dropdown: the 6 main courses.
    courseSelect.replaceChildren();
    for (const course of COURSES) {
      const opt = document.createElement('option');
      opt.value = course.courseId;
      opt.textContent = course.courseTitle;
      courseSelect.append(opt);
    }

    // Current enrollments list (with Unenroll buttons).
    listBody.replaceChildren();
    const enrollmentDocs = enrollments ? enrollments.docs : [];
    if (!enrollments) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = 'Could not load enrollments. Check the published Firestore Rules for the enrollments collection, then refresh.';
      row.append(cell);
      listBody.append(row);
    } else if (enrollmentDocs.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = 'No enrollments yet.';
      row.append(cell);
      listBody.append(row);
    }
    for (const record of enrollmentDocs) {
      const data = record.data();
      const row = document.createElement('tr');
      for (const value of [
        (userById[data.uid] && userById[data.uid].displayName) || data.uid || '—',
        data.courseTitle || data.courseId || '—',
        data.resourceUrl || '—'
      ]) {
        const cell = document.createElement('td');
        safeText(cell, value);
        row.append(cell);
      }
      const actionCell = document.createElement('td');
      const removeBtn = document.createElement('button');
      removeBtn.className = 'portal-btn';
      removeBtn.textContent = 'Unenroll';
      removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true;
        try {
          await deleteDoc(doc(db, 'enrollments', record.id));
          await showAdmin();
          status('Enrollment removed.');
        } catch (error) {
          status('Unenroll failed: ' + errorMessage(error), true);
          removeBtn.disabled = false;
        }
      });
      actionCell.append(removeBtn);
      row.append(actionCell);
      listBody.append(row);
    }

    // Enroll button: create the enrollment, or update the entry point if one exists.
    enrollBtn.onclick = async () => {
      const uid = studentSelect.value;
      const course = COURSES.find((item) => item.courseId === courseSelect.value);
      if (!uid || !course) {
        status('Choose a student and a course first.', true);
        return;
      }
      enrollBtn.disabled = true;
      try {
        // 0417 has a legacy courseId ('ict-0417-notes') from the pilot enrollment.
        const existing = enrollmentDocs.find((record) => {
          const data = record.data();
          return data.uid === uid && (data.courseId === course.courseId
            || (course.courseId === 'ict-0417' && data.courseId === 'ict-0417-notes'));
        });
        if (existing) {
          await updateDoc(doc(db, 'enrollments', existing.id), {
            courseId: course.courseId,
            courseTitle: course.courseTitle,
            resourceUrl: course.resourceUrl
          });
          await showAdmin();
          status('Already enrolled — entry point updated to ' + course.resourceUrl + '.');
        } else {
          await addDoc(collection(db, 'enrollments'), {
            uid: uid,
            courseId: course.courseId,
            courseTitle: course.courseTitle,
            resourceUrl: course.resourceUrl,
            createdAt: serverTimestamp()
          });
          await showAdmin();
          status('Enrolled ' + ((userById[uid] && userById[uid].displayName) || uid) + ' in ' + course.courseTitle + '.');
        }
      } catch (error) {
        status('Enroll failed: ' + errorMessage(error), true);
      } finally {
        enrollBtn.disabled = false;
      }
    };
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
    // Enrollments load separately: if the Rules do not allow the admin to
    // list them yet, the rest of the dashboard must still work.
    let enrollments = null;
    try {
      enrollments = await getDocs(collection(db, 'enrollments'));
    } catch (error) {
      console.warn('Could not load enrollments. Check the published Firestore Rules for /enrollments.', error);
    }
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
    renderEnroll(users, enrollments);
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
