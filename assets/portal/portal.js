import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs, query, where, serverTimestamp, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, firebaseReady } from "./firebase-config.js";
const $ = id => document.getElementById(id);
const status = (message, error=false) => { const el=$('status'); if(el){el.textContent=message;el.classList.toggle('portal-error',error);} };
const page = document.body.dataset.portalPage;
if (!firebaseReady) {
  status('Firebase is not configured yet. Follow FIREBASE_SETUP.md before enabling student login.',true);
  const b=$('google-login');if(b)b.disabled=true;
} else {
  const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
  const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
  const loginButton=$('google-login');
  if(loginButton)loginButton.addEventListener('click',async()=>{
    loginButton.disabled=true;
    try{await signInWithPopup(auth,provider);}catch(e){
      if(e.code==='auth/popup-blocked'){try{await signInWithRedirect(auth,provider);}catch(err){status('Sign-in failed: '+err.message,true);}}
      else if(e.code!=='auth/popup-closed-by-user')status('Sign-in failed: '+e.message,true);
    }finally{loginButton.disabled=false;}
  });
  getRedirectResult(auth).catch(e=>status('Sign-in redirect failed: '+e.message,true));
  const logout=$('logout');if(logout)logout.addEventListener('click',()=>signOut(auth).then(()=>location.assign('login.html')).catch(e=>status(e.message,true)));
  const isAdmin=async uid=>(await getDoc(doc(db,'admins',uid))).exists();
  const profile=async user=>{
    const ref=doc(db,'users',user.uid),snap=await getDoc(ref);
    if(!snap.exists()){
      await setDoc(ref,{displayName:user.displayName||'',email:user.email||'',approved:false,createdAt:serverTimestamp(),lastLoginAt:serverTimestamp()});
      return {approved:false,displayName:user.displayName||'',email:user.email||''};
    }
    return snap.data();
  };
  // Count successful sign-in transitions for this tab, not every page refresh.
  const logLogin=async user=>{
    const key='wlh-login-logged:'+user.uid;
    if(sessionStorage.getItem(key))return;
    await addDoc(collection(db,'loginEvents'),{uid:user.uid,at:serverTimestamp()});
    sessionStorage.setItem(key,'1');
  };
  const logView=async(user,courseId)=>{
    if(!courseId)return;
    await addDoc(collection(db,'lessonViews'),{uid:user.uid,courseId,at:serverTimestamp()});
  };
  const safeText=(node,text)=>{node.textContent=String(text??'');};
  const showCourses=async user=>{
    const snap=await getDocs(query(collection(db,'enrollments'),where('uid','==',user.uid)));
    const list=$('courses-list');list.replaceChildren();
    if(snap.empty){list.textContent='No courses assigned yet. Please contact your teacher.';return;}
    for(const record of snap.docs){
      const x=record.data(),card=document.createElement('article');card.className='portal-panel';
      const title=document.createElement('h3');safeText(title,x.courseTitle||x.courseId||'Course');card.append(title);
      const desc=document.createElement('p');desc.className='portal-muted';desc.textContent='Approved course resource';card.append(desc);
      const link=document.createElement('a');link.className='portal-secondary';link.textContent='Open course resource';
      // Only approved students see links. Legacy static HTML is still publicly accessible by direct URL.
      if(typeof x.resourceUrl==='string' && (/^https:\/\//.test(x.resourceUrl)||/^[a-zA-Z0-9_./-]+\.html$/.test(x.resourceUrl))){link.href=x.resourceUrl;link.rel='noopener noreferrer';link.addEventListener('click',()=>{logView(user,x.courseId||'unknown').catch(console.warn);});card.append(link);}
      list.append(card);
    }
  };
  const showAdmin=async()=>{
    const [u,e,v]=await Promise.all([getDocs(collection(db,'users')),getDocs(query(collection(db,'loginEvents'),orderBy('at','desc'),limit(500))),getDocs(query(collection(db,'lessonViews'),orderBy('at','desc'),limit(500)))]);
    $('student-count').textContent=u.size;$('login-count').textContent=String(e.size)+' (latest 500 max)';$('view-count').textContent=String(v.size)+' (latest 500 max)';
    const counts={};for(const x of e.docs){const uid=x.data().uid;counts[uid]=(counts[uid]||0)+1;}
    const tbody=$('student-rows');tbody.replaceChildren();
    for(const item of u.docs){const d=item.data(),tr=document.createElement('tr');
      for(const value of [d.displayName||'—',d.email||'—',d.approved?'Approved':'Pending',counts[item.id]||0]){const td=document.createElement('td');safeText(td,value);tr.append(td);}
      const action=document.createElement('td'),button=document.createElement('button');button.className='portal-btn';button.textContent=d.approved?'Revoke':'Approve';
      button.addEventListener('click',async()=>{button.disabled=true;try{await updateDoc(doc(db,'users',item.id),{approved:!d.approved});await showAdmin();status('Student approval updated.');}catch(err){status(err.message,true);button.disabled=false;}});
      action.append(button);tr.append(action);tbody.append(tr);
    }
  };
  onAuthStateChanged(auth,async user=>{
    try{
      if(!user){if(page==='login'){status('Sign in with your Google account to request access.');return;}location.replace('login.html');return;}
      const admin=await isAdmin(user.uid),p=await profile(user);
      try{await logLogin(user);}catch(err){console.warn('Login event not recorded:',err);}
      if(page==='login'){
        if(admin){location.replace('admin-dashboard.html');return;}
        if(p.approved){location.replace('student-dashboard.html');return;}
        status('Registration received. Your teacher must approve your account before course access is enabled.');
        if($('google-login'))$('google-login').hidden=true;
      }else if(page==='student'){
        if(!p.approved&&!admin){status('Your account is pending teacher approval.');return;}
        $('student-area').hidden=false;$('student-name').textContent=p.displayName||user.email||'Student';
        await showCourses(user);status('Signed in.');
      }else if(page==='admin'){
        if(!admin){status('Teacher access only. Your account does not have administrator permission.',true);return;}
        $('admin-area').hidden=false;await showAdmin();status('Teacher dashboard loaded.');
      }
    }catch(err){status('Unable to load your account: '+err.message,true);}
  });
}
