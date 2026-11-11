// SrWL Learning Firebase Web App configuration (public client identifiers).
// Firebase security is enforced by Authentication and Firestore Rules.
export const firebaseConfig = {
  apiKey: "AIzaSyCI2Ke9YTPOclGUV3t9880e50IfGnk_IgQ",
  authDomain: "srwl-learning.firebaseapp.com",
  projectId: "srwl-learning",
  storageBucket: "srwl-learning.firebasestorage.app",
  messagingSenderId: "890455710785",
  appId: "1:890455710785:web:d84c0d4da8ea4577adfac0"
};
export const firebaseReady = !Object.values(firebaseConfig).some(v => v.includes('REPLACE_WITH'));
