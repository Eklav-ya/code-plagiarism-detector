import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAowCfGSAopTpj0mb8EOqr6Qgnorp6OUJ8",
  authDomain: "code-plagiarism-detector-10636.firebaseapp.com",
  projectId: "code-plagiarism-detector-10636",
  storageBucket: "code-plagiarism-detector-10636.firebasestorage.app",
  messagingSenderId: "613964973960",
  appId: "1:613964973960:web:005d835c00614e7bdbdc3d",
  measurementId: "G-29YWCBFM20"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app); 