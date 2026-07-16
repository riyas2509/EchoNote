
import { toast } from 'sonner';
import { db, doc, updateDoc, increment, serverTimestamp } from '../firebase';

const getApiUrl = (path: string) => {
  const baseUrl = import.meta.env.VITE_API_URL || "";
  return `${baseUrl}${path}`;
};

export const handleUpgrade = async (userId: string, email: string, displayName: string, planId: string, billingCycle: string = 'monthly') => {
  if (!userId) {
    toast.error("Please sign in to upgrade.");
    return;
  }

  try {
    const resp = await fetch(getApiUrl("/api/create-order"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, planId, billingCycle })
    });
    const order = await resp.json();

    if (order.error) throw new Error(order.error);

    const options = {
      key: order.key,
      amount: order.amount,
      currency: order.currency,
      name: `EchoNote ${planId.charAt(0).toUpperCase() + planId.slice(1)}`,
      description: `${billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1)} Subscription`,
      order_id: order.id,
      handler: async (response: any) => {
        const verifyResp = await fetch(getApiUrl("/api/verify-payment"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...response,
            userId,
            planId,
            billingCycle
          })
        });
        const result = await verifyResp.json();
        if (result.success) {
          try {
            const now = new Date();
            const subscriptionStartDate = now.toISOString();
            const nextRefreshDate = new Date(subscriptionStartDate);
            if (billingCycle === 'yearly') {
              nextRefreshDate.setFullYear(nextRefreshDate.getFullYear() + 1);
            } else {
              nextRefreshDate.setMonth(nextRefreshDate.getMonth() + 1);
            }

            const expiryDate = new Date(now);
            if (billingCycle === 'yearly') {
              expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            } else {
              expiryDate.setMonth(expiryDate.getMonth() + 1);
            }

            await updateDoc(doc(db, "users", userId), {
              plan: planId || "pro",
              billingCycle: billingCycle || "monthly",
              subscriptionStartDate: subscriptionStartDate,
              nextRefreshDate: nextRefreshDate.toISOString(),
              billingStartDate: subscriptionStartDate,
              planExpiresAt: expiryDate.toISOString(),
              lastPaymentDate: serverTimestamp()
            });
          } catch (dbErr: any) {
            console.error("⚠️ Client-side Firestore user plan update failed:", dbErr);
          }

          toast.success(`Welcome to EchoNote ${planId.charAt(0).toUpperCase() + planId.slice(1)}!`);
          window.location.reload(); // Refresh to update profile
        } else {
          toast.error("Payment verification failed.");
        }
      },
      prefill: {
        email: email,
        name: displayName || ""
      },
      theme: {
        color: "#1B2A4E"
      }
    };

    if (order.isDemo || (order.id && order.id.startsWith("order_mock_"))) {
      toast.info("Simulating Razorpay Payment (Demo/Sandbox Mode)...");
      setTimeout(async () => {
        await options.handler({
          razorpay_order_id: order.id,
          razorpay_payment_id: "pay_mock_" + Math.random().toString(36).substring(2, 10),
          razorpay_signature: "sig_mock_" + Math.random().toString(36).substring(2, 10),
        });
      }, 1500);
      return;
    }

    const rzp = new (window as any).Razorpay(options);
    rzp.open();
  } catch (err: any) {
    toast.error(err.message || "Failed to start payment process.");
  }
};

export const handleTopup = async (userId: string, email: string, displayName: string, minutes: number, price: number) => {
  if (!userId) {
    toast.error("Please sign in to top-up.");
    return;
  }

  try {
    const resp = await fetch(getApiUrl("/api/create-order"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        userId, 
        type: 'topup',
        minutes,
        amount: price * 100 // Pre-calculated or verified on server
      })
    });
    const order = await resp.json();

    if (order.error) throw new Error(order.error);

    const options = {
      key: order.key,
      amount: order.amount,
      currency: order.currency,
      name: "Minutes Top-up",
      description: `Add ${minutes} transcription minutes`,
      order_id: order.id,
      handler: async (response: any) => {
        const verifyResp = await fetch(getApiUrl("/api/verify-payment"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...response,
            userId,
            type: 'topup',
            minutes
          })
        });
        const result = await verifyResp.json();
        if (result.success) {
          try {
            await updateDoc(doc(db, "users", userId), {
              extraMinutes: increment(minutes || 0),
              lastPaymentDate: serverTimestamp()
            });
          } catch (dbErr: any) {
            console.error("⚠️ Client-side Firestore user extraMinutes update failed:", dbErr);
          }

          toast.success(`Successfully added ${minutes} minutes!`);
          window.location.reload(); 
        } else {
          toast.error("Payment verification failed.");
        }
      },
      prefill: {
        email: email,
        name: displayName || ""
      },
      theme: {
        color: "#1B2A4E"
      }
    };

    if (order.isDemo || (order.id && order.id.startsWith("order_mock_"))) {
      toast.info("Simulating Razorpay Payment (Demo/Sandbox Mode)...");
      setTimeout(async () => {
        await options.handler({
          razorpay_order_id: order.id,
          razorpay_payment_id: "pay_mock_" + Math.random().toString(36).substring(2, 10),
          razorpay_signature: "sig_mock_" + Math.random().toString(36).substring(2, 10),
        });
      }, 1500);
      return;
    }

    const rzp = new (window as any).Razorpay(options);
    rzp.open();
  } catch (err: any) {
    toast.error(err.message || "Failed to start top-up process.");
  }
};
