import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signOut,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import { auth } from "./firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(undefined);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUser(u ?? null));
    return unsub;
  }, []);

  async function logout() {
    return signOut(auth);
  }

  async function loginWithGoogle() {
    return signInWithPopup(auth, new GoogleAuthProvider());
  }

  async function loginWithEmail(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function signupWithEmail(email, password, name) {
    const res = await createUserWithEmailAndPassword(auth, email, password);

    // ✅ FIX: save display name
    if (name) {
      await updateProfile(res.user, { displayName: name });
    }

    return res;
  }

  if (currentUser === undefined) {
    return <div style={{ textAlign: "center", marginTop: "40vh" }}>Loading...</div>;
  }

  return (
    <AuthContext.Provider value={{
      user: currentUser,
      logout,
      loginWithGoogle,
      loginWithEmail,
      signupWithEmail
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}