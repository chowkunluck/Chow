import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  getRedirectResult,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// นำค่ามาจาก Firebase Console -> Project Settings
const firebaseConfig = {
  apiKey: "AIzaSyA4jFMtnVClD5KbaAfvNvAQ12RBP8_l_Gc",
  authDomain: "my-money-bd266.firebaseapp.com",
  projectId: "my-money-bd266",
  storageBucket: "my-money-bd266.firebasestorage.app",
  messagingSenderId: "156226404889",
  appId: "1:156226404889:web:878857e552b95e23dd2088",
  measurementId: "G-LV5ZHG5FY9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const loginWithGoogle = async () => {
  try {
    // ใช้ popup แทน redirect เพื่อหลีกเลี่ยงปัญหา 404 /__/firebase/init.json บน authDomain
    // (กรณีไม่ได้เปิด/ตั้งค่า Firebase Hosting สำหรับโดเมนนั้น)
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Login Error:", error);
  }
};

/** Call once on app load after signInWithRedirect so the session finalizes. */
export const completeGoogleRedirect = () => getRedirectResult(auth);

export const logout = async () => {
  try {
    localStorage.removeItem("rw_token");
    await signOut(auth);
  } catch (error) {
    console.error("Logout Error:", error);
  }
};

// ฟังก์ชันจัดการ Error เบื้องต้น
export enum OperationType { WRITE, READ }
export const handleFirestoreError = (e: any, type: OperationType, path: string) => {
  console.error(`Firestore Error at ${path}:`, e);
};
