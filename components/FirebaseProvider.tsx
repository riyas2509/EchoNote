
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, onAuthStateChanged, User, db, doc, getDoc, getDocFromServer, setDoc, onSnapshot, updateDoc } from '../firebase';
import { UserProfile } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';
import { shouldResetUsage, getAdvancedRefreshDate, migrateLegacyUserFields, calculateNextRefreshDate } from '../lib/usageUtils';

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

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setProfile(null);
        setIsAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    let unsubscribeProfile: (() => void) | null = null;

    const setupProfile = async () => {
      try {
        console.log('Setting up profile for user:', user.uid);
        
        const userDocRef = doc(db, 'users', user.uid);
        
        // Initial check and creation if needed
        const userDoc = await getDocFromServer(userDocRef);
        if (!userDoc.exists()) {
          const now = new Date();
          const nowStr = now.toISOString();
          const nextRefresh = calculateNextRefreshDate(nowStr, 'monthly', 'free', nowStr);

          const displayName = user.displayName || user.email?.split('@')[0] || 'User';

          const newProfile: UserProfile = {
            uid: user.uid,
            email: user.email || '',
            name: displayName,
            displayName: displayName,
            photoURL: user.photoURL || '',
            avatarUrl: user.photoURL || '',
            role: 'user',
            plan: 'free',
            minutesUsed: 0,
            thinkingUsed: 0,
            extraMinutes: 0,
            billingStartDate: nowStr,
            lastResetDate: nowStr,
            planExpiresAt: nextRefresh.toISOString(),
            createdAt: nowStr,
            subscriptionStartDate: nowStr,
            billingCycle: 'monthly',
            nextRefreshDate: nextRefresh.toISOString(),
            lastUsageResetDate: nowStr
          };
          await setDoc(userDocRef, newProfile);
        } else {
          // SYNC CHECK: If Firestore profile is missing displayName but Firebase Auth has it
          let currentData = userDoc.data() as UserProfile;
          
          // Migration of legacy user fields
          if (!currentData.subscriptionStartDate || !currentData.nextRefreshDate || !currentData.billingCycle || !currentData.lastUsageResetDate) {
            console.log("🔄 Migrating legacy user fields in setupProfile...");
            const migratedFields = migrateLegacyUserFields(currentData);
            const updateObj = {
              ...migratedFields,
              billingStartDate: migratedFields.subscriptionStartDate,
              lastResetDate: migratedFields.lastUsageResetDate
            };
            await updateDoc(userDocRef, updateObj);
            currentData = {
              ...currentData,
              ...updateObj
            };
          }

          // Check for usage reset
          if (shouldResetUsage(currentData.nextRefreshDate)) {
            console.log("♻️ Billing cycle reset triggered...");
            const advancedNextRefresh = getAdvancedRefreshDate(currentData.nextRefreshDate, currentData.billingCycle, currentData.plan);
            await updateDoc(userDocRef, {
              minutesUsed: 0,
              thinkingUsed: 0,
              nextRefreshDate: advancedNextRefresh.toISOString(),
              lastUsageResetDate: currentData.nextRefreshDate,
              lastResetDate: currentData.nextRefreshDate
            });
            currentData = {
              ...currentData,
              minutesUsed: 0,
              thinkingUsed: 0,
              nextRefreshDate: advancedNextRefresh.toISOString(),
              lastUsageResetDate: currentData.nextRefreshDate,
              lastResetDate: currentData.nextRefreshDate
            };
          }

          if (!currentData.billingStartDate) {
            console.log("🔄 Initializing billingStartDate for legacy user...");
            await updateDoc(userDocRef, {
              billingStartDate: currentData.createdAt || new Date().toISOString()
            });
          }

          const syncUpdates: any = {};
          if (!currentData.displayName && user.displayName) {
            syncUpdates.displayName = user.displayName;
            syncUpdates.name = user.displayName;
          }
          if (user.photoURL && (!currentData.photoURL || !currentData.avatarUrl)) {
            syncUpdates.photoURL = user.photoURL;
            syncUpdates.avatarUrl = user.photoURL;
          }

          if (Object.keys(syncUpdates).length > 0) {
            console.log("🔄 Syncing auth profile fields to Firestore...", syncUpdates);
            await updateDoc(userDocRef, syncUpdates);
          }
        }

        // Real-time listener
        console.log("📡 Firestore listener started: userProfile");
        unsubscribeProfile = onSnapshot(userDocRef, async (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            console.log("🔥 Firestore user data sync:", data);
            
            // Check if fields are missing
            if (!data.subscriptionStartDate || !data.nextRefreshDate || !data.billingCycle || !data.lastUsageResetDate) {
              console.log("🔄 Live migrating legacy user fields...");
              const migratedFields = migrateLegacyUserFields(data);
              await updateDoc(userDocRef, {
                ...migratedFields,
                billingStartDate: migratedFields.subscriptionStartDate,
                lastResetDate: migratedFields.lastUsageResetDate
              });
              return;
            }

            // Check if usage reset is needed
            if (shouldResetUsage(data.nextRefreshDate)) {
              console.log("♻️ Live billing cycle reset triggered...");
              const advancedNextRefresh = getAdvancedRefreshDate(data.nextRefreshDate, data.billingCycle, data.plan);
              await updateDoc(userDocRef, {
                minutesUsed: 0,
                thinkingUsed: 0,
                nextRefreshDate: advancedNextRefresh.toISOString(),
                lastUsageResetDate: data.nextRefreshDate,
                lastResetDate: data.nextRefreshDate
              });
              return;
            }

            // CHECK FOR EXPIRY
            if (data.plan !== 'free' && data.plan !== 'guest' && data.planExpiresAt) {
              const expiry = new Date(data.planExpiresAt);
              if (expiry < new Date()) {
                console.log("⚠️ Plan expired, downgrading to free...");
                const nowStr = new Date().toISOString();
                const nextRefreshFree = calculateNextRefreshDate(nowStr, 'monthly', 'free', data.createdAt || nowStr);
                await updateDoc(userDocRef, {
                  plan: 'free',
                  billingCycle: 'monthly',
                  subscriptionStartDate: data.createdAt || nowStr,
                  nextRefreshDate: nextRefreshFree.toISOString(),
                  planExpiresAt: nextRefreshFree.toISOString()
                });
                return;
              }
            }

            setProfile(data);
          }
          setIsAuthReady(true);
        }, (error) => {
          // Ignore permission errors if user is logging out
          if (auth.currentUser) {
            console.error('Profile listener error:', error);
          }
        });
      } catch (error) {
        console.error('Error in profile setup:', error);
        setIsAuthReady(true);
      }
    };

    setupProfile();

    return () => {
      if (unsubscribeProfile) {
        console.log("🛑 Firestore listener stopped: userProfile");
        unsubscribeProfile();
      }
    };
  }, [user]);

  return (
    <FirebaseContext.Provider value={{ user, profile, isAuthReady }}>
      {children}
    </FirebaseContext.Provider>
  );
};
