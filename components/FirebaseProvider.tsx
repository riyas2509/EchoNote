
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, onAuthStateChanged, User, db, doc, getDoc, setDoc, onSnapshot } from '../firebase';
import { UserProfile } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';

interface FirebaseContextType {
  user: User | null;
  profile: UserProfile | null;
  isAuthReady: boolean;
}

const FirebaseContext = createContext<FirebaseContextType>({
  user: null,
  profile: null,
  isAuthReady: false,
});

export const useFirebase = () => useContext(FirebaseContext);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    if (!auth) {
      setIsAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (firebaseUser) {
        // Fetch or create profile
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        
        // Initial check and creation if needed
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) {
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            name: firebaseUser.displayName || '',
            role: 'user',
            plan: 'free',
            minutesUsed: 0,
            minutesLimit: PLAN_FEATURES.free.totalMinutesLimit,
            thinkingUsageCount: 0,
            createdAt: new Date().toISOString()
          };
          await setDoc(userDocRef, newProfile);
        }

        // Real-time listener
        const unsubscribeProfile = onSnapshot(userDocRef, (doc) => {
          if (doc.exists()) {
            setProfile(doc.data() as UserProfile);
          }
        });

        setIsAuthReady(true);
        return () => unsubscribeProfile();
      } else {
        setProfile(null);
        setIsAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <FirebaseContext.Provider value={{ user, profile, isAuthReady }}>
      {children}
    </FirebaseContext.Provider>
  );
};
