
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { auth, onAuthStateChanged, User, getRedirectResult, db, doc, getDoc, getDocFromServer, setDoc, onSnapshot, updateDoc } from '../firebase';
import { UserProfile, CustomClaims } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';
import { shouldResetUsage, getAdvancedRefreshDate, migrateLegacyUserFields, calculateNextRefreshDate } from '../lib/usageUtils';
import { apiFetch } from '../lib/apiClient';

interface FirebaseContextType {
  user: User | null;
  profile: UserProfile | null;
  customClaims: CustomClaims | null;
  isAuthReady: boolean;
  refreshClaims: () => Promise<CustomClaims | null>;
}

const FirebaseContext = createContext<FirebaseContextType>({
  user: null,
  profile: null,
  customClaims: null,
  isAuthReady: false,
  refreshClaims: async () => null,
});

export const useFirebase = () => useContext(FirebaseContext);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [customClaims, setCustomClaims] = useState<CustomClaims | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const refreshClaims = useCallback(async (): Promise<CustomClaims | null> => {
    if (!auth?.currentUser) {
      setCustomClaims(null);
      return null;
    }

    try {
      // 1. Force refresh the Firebase ID Token
      const tokenResult = await auth.currentUser.getIdTokenResult(true);
      const claims: CustomClaims = {
        orgId: tokenResult.claims.orgId as string | undefined,
        orgRole: tokenResult.claims.orgRole as any,
        role: tokenResult.claims.role as any,
        platform_admin: Boolean(tokenResult.claims.platform_admin),
        isOwner: Boolean(tokenResult.claims.isOwner || tokenResult.claims.orgRole === 'owner')
      };

      // 2. If claims are not yet set or need backend sync, call sync-claims
      if (!claims.orgId) {
        try {
          const syncRes = await apiFetch('/api/auth/sync-claims', {
            method: 'POST'
          });
          if (syncRes.ok) {
            const data = await syncRes.json();
            if (data.claims) {
              const freshTokenResult = await auth.currentUser.getIdTokenResult(true);
              const updatedClaims: CustomClaims = {
                orgId: freshTokenResult.claims.orgId as string | undefined || data.claims.orgId,
                orgRole: freshTokenResult.claims.orgRole as any || data.claims.orgRole,
                role: freshTokenResult.claims.role as any || data.claims.role,
                platform_admin: Boolean(freshTokenResult.claims.platform_admin || data.claims.platform_admin),
                isOwner: Boolean(freshTokenResult.claims.isOwner || data.claims.orgRole === 'owner')
              };
              setCustomClaims(updatedClaims);
              return updatedClaims;
            }
          }
        } catch (syncErr) {
          console.warn("⚠️ Claim sync request warning:", syncErr);
        }
      }

      setCustomClaims(claims);
      return claims;
    } catch (err) {
      console.error("⚠️ Failed to refresh claims:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      setIsAuthReady(true);
      return;
    }

    // Check for enterprise or social redirect result
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          try {
            await apiFetch('/api/auth/sso/validate', {
              method: 'POST'
            });
            await result.user.getIdToken(true);
          } catch (syncErr) {
            console.warn("⚠️ Redirect auth synchronization note:", syncErr);
          }
        }
      })
      .catch((err) => {
        console.warn("⚠️ Redirect authentication result info:", err);
      });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setProfile(null);
        setCustomClaims(null);
        setIsAuthReady(true);
      } else {
        try {
          const tokenResult = await firebaseUser.getIdTokenResult();
          const claims: CustomClaims = {
            orgId: tokenResult.claims.orgId as string | undefined,
            orgRole: tokenResult.claims.orgRole as any,
            role: tokenResult.claims.role as any,
            platform_admin: Boolean(tokenResult.claims.platform_admin),
            isOwner: Boolean(tokenResult.claims.isOwner || tokenResult.claims.orgRole === 'owner')
          };
          setCustomClaims(claims);
        } catch (err) {
          console.warn("⚠️ Initial claims inspection note:", err);
        }
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
        let userDoc;
        try {
          userDoc = await getDoc(userDocRef);
        } catch (fetchErr) {
          console.warn("⚠️ Initial profile getDoc warning (will rely on snapshot):", fetchErr);
        }
        if (userDoc && !userDoc.exists()) {
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
            lastUsageResetDate: nowStr,
            monthlyMinuteLimit: 60,
            monthlyMinutesUsed: 0,
            minuteTopupBalance: 0,
            monthlyThinkingLimit: 10,
            monthlyThinkingUsed: 0,
            thinkingTopupBalance: 0
          };
          try {
            await setDoc(userDocRef, newProfile);
          } catch (initErr) {
            console.warn("⚠️ Initial profile creation setDoc notice:", initErr);
          }
        } else if (userDoc && userDoc.exists()) {
          // SYNC CHECK: If Firestore profile is missing displayName but Firebase Auth has it
          let currentData = userDoc.data() as UserProfile;
          
          // Migration of legacy user fields
          if (!currentData.subscriptionStartDate || !currentData.nextRefreshDate || !currentData.billingCycle || !currentData.lastUsageResetDate || currentData.monthlyMinuteLimit === undefined) {
            console.log("🔄 Migrating legacy user fields in setupProfile...");
            const migratedFields = migrateLegacyUserFields(currentData);
            const planLimits = {
              free: { minutes: 60, thinking: 10 },
              pro: { minutes: 1200, thinking: 250 },
              team: { minutes: 5000, thinking: 1500 },
              enterprise: { minutes: 25000, thinking: 10000 }
            };
            const limits = planLimits[(currentData.plan || "free") as keyof typeof planLimits] || planLimits.free;

            const updateObj = {
              ...migratedFields,
              billingStartDate: migratedFields.subscriptionStartDate,
              lastResetDate: migratedFields.lastUsageResetDate,
              monthlyMinutesUsed: currentData.monthlyMinutesUsed ?? currentData.minutesUsed ?? 0,
              minuteTopupBalance: currentData.minuteTopupBalance ?? currentData.extraMinutes ?? 0,
              monthlyThinkingUsed: currentData.monthlyThinkingUsed ?? currentData.thinkingUsed ?? 0,
              thinkingTopupBalance: currentData.thinkingTopupBalance ?? 0
            };
            try {
              await updateDoc(userDocRef, updateObj);
            } catch (migErr) {
              console.warn("⚠️ Legacy fields client update skipped (handled server-side):", migErr);
            }
            currentData = {
              ...currentData,
              ...updateObj,
              monthlyMinuteLimit: currentData.monthlyMinuteLimit ?? limits.minutes,
              monthlyThinkingLimit: currentData.monthlyThinkingLimit ?? limits.thinking
            };
          }

          // Check for usage reset
          if (shouldResetUsage(currentData.nextRefreshDate)) {
            console.log("♻️ Billing cycle reset triggered...");
            const advancedNextRefresh = getAdvancedRefreshDate(currentData.nextRefreshDate, currentData.billingCycle, currentData.plan);
            try {
              await updateDoc(userDocRef, {
                minutesUsed: 0,
                thinkingUsed: 0,
                monthlyMinutesUsed: 0,
                monthlyThinkingUsed: 0,
                nextRefreshDate: advancedNextRefresh.toISOString(),
                lastUsageResetDate: currentData.nextRefreshDate,
                lastResetDate: currentData.nextRefreshDate
              });
            } catch (resetErr) {
              console.warn("⚠️ Billing cycle reset client update skipped:", resetErr);
            }
            currentData = {
              ...currentData,
              minutesUsed: 0,
              thinkingUsed: 0,
              monthlyMinutesUsed: 0,
              monthlyThinkingUsed: 0,
              nextRefreshDate: advancedNextRefresh.toISOString(),
              lastUsageResetDate: currentData.nextRefreshDate,
              lastResetDate: currentData.nextRefreshDate
            };
          }

          if (!currentData.billingStartDate) {
            console.log("🔄 Initializing billingStartDate for legacy user...");
            try {
              await updateDoc(userDocRef, {
                billingStartDate: currentData.createdAt || new Date().toISOString()
              });
            } catch (bErr) {
              console.warn("⚠️ billingStartDate client update skipped:", bErr);
            }
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
            try {
              await updateDoc(userDocRef, syncUpdates);
            } catch (sErr) {
              console.warn("⚠️ sync auth profile fields skipped:", sErr);
            }
          }
        }

        // Real-time listener
        console.log("📡 Firestore listener started: userProfile");
        unsubscribeProfile = onSnapshot(userDocRef, async (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            console.log("🔥 Firestore user data sync:", data);
            
            // Check if fields are missing
            if (!data.subscriptionStartDate || !data.nextRefreshDate || !data.billingCycle || !data.lastUsageResetDate || data.monthlyMinuteLimit === undefined) {
              console.log("🔄 Live migrating legacy user fields...");
              const migratedFields = migrateLegacyUserFields(data);
              const planLimits = {
                free: { minutes: 60, thinking: 10 },
                pro: { minutes: 1200, thinking: 250 },
                team: { minutes: 5000, thinking: 1500 },
                enterprise: { minutes: 25000, thinking: 10000 }
              };
              const limits = planLimits[(data.plan || "free") as keyof typeof planLimits] || planLimits.free;

              const liveUpdateObj = {
                ...migratedFields,
                billingStartDate: migratedFields.subscriptionStartDate,
                lastResetDate: migratedFields.lastUsageResetDate,
                monthlyMinutesUsed: data.monthlyMinutesUsed ?? data.minutesUsed ?? 0,
                minuteTopupBalance: data.minuteTopupBalance ?? data.extraMinutes ?? 0,
                monthlyThinkingUsed: data.monthlyThinkingUsed ?? data.thinkingUsed ?? 0,
                thinkingTopupBalance: data.thinkingTopupBalance ?? 0
              };

              try {
                await updateDoc(userDocRef, liveUpdateObj);
              } catch (migErr) {
                console.warn("⚠️ Live migration client update skipped (handled server-side):", migErr);
              }

              setProfile({
                ...data,
                ...liveUpdateObj,
                monthlyMinuteLimit: data.monthlyMinuteLimit ?? limits.minutes,
                monthlyThinkingLimit: data.monthlyThinkingLimit ?? limits.thinking
              });
              setIsAuthReady(true);
              return;
            }

            // Check if usage reset is needed
            if (shouldResetUsage(data.nextRefreshDate)) {
              console.log("♻️ Live billing cycle reset triggered...");
              const advancedNextRefresh = getAdvancedRefreshDate(data.nextRefreshDate, data.billingCycle, data.plan);
              try {
                await updateDoc(userDocRef, {
                  minutesUsed: 0,
                  thinkingUsed: 0,
                  monthlyMinutesUsed: 0,
                  monthlyThinkingUsed: 0,
                  nextRefreshDate: advancedNextRefresh.toISOString(),
                  lastUsageResetDate: data.nextRefreshDate,
                  lastResetDate: data.nextRefreshDate
                });
              } catch (resetErr) {
                console.warn("⚠️ Billing cycle reset update skipped:", resetErr);
              }
              return;
            }

            // CHECK FOR EXPIRY
            if (data.plan !== 'free' && data.plan !== 'guest' && data.planExpiresAt) {
              const expiry = new Date(data.planExpiresAt);
              if (expiry < new Date()) {
                console.log("⚠️ Plan expired, downgrading to free...");
                const nowStr = new Date().toISOString();
                const nextRefreshFree = calculateNextRefreshDate(nowStr, 'monthly', 'free', data.createdAt || nowStr);
                try {
                  await updateDoc(userDocRef, {
                    billingCycle: 'monthly',
                    subscriptionStartDate: data.createdAt || nowStr,
                    nextRefreshDate: nextRefreshFree.toISOString(),
                    planExpiresAt: nextRefreshFree.toISOString()
                  });
                } catch (expErr) {
                  console.warn("⚠️ Plan expiry update skipped:", expErr);
                }
                return;
              }
            }

            setProfile(data);
          }
          setIsAuthReady(true);
        }, (error) => {
          // Ignore permission errors if user is logging out
          if (auth.currentUser) {
            console.warn('⚠️ Profile listener notice:', error);
          }
        });
      } catch (error) {
        console.warn('⚠️ Profile setup notice:', error);
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
    <FirebaseContext.Provider value={{ user, profile, customClaims, isAuthReady, refreshClaims }}>
      {children}
    </FirebaseContext.Provider>
  );
};
