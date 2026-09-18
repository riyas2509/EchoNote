import { toast } from 'sonner';
import { apiFetch, getApiUrl, safeApiJson } from '../lib/apiClient';

/**
 * Note: Billing transactions and entitlements are strictly server-authoritative
 * via Cloud Functions / Express API routes (POST /api/verify-payment, /api/downgrade-plan, etc.).
 * Client-side code never writes to transactions or entitlements directly.
 */

/**
 * Handle Recurring Subscription Upgrade (PRO / TEAM)
 * Authoritatively creates a Razorpay Subscription via POST /api/create-subscription
 */
export const handleUpgrade = async (
  userId: string, 
  email: string, 
  displayName: string, 
  planId: string, 
  billingCycle: string = 'monthly'
) => {
  if (!userId) {
    toast.error("Please sign in to upgrade.");
    return;
  }

  if (typeof (window as any).Razorpay === 'undefined') {
    toast.error("Razorpay payment checkout failed to load. Please check your internet connection or disable ad-blockers and try again.");
    return;
  }

  try {
    const resp = await apiFetch(getApiUrl("/api/create-subscription"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        planId: planId.toLowerCase(), 
        billingCycle: billingCycle.toLowerCase() 
      })
    });
    const sub = await safeApiJson<{ key: string; subscriptionId: string; planId?: string; billingCycle?: string }>(resp);

    const options = {
      key: sub.key,
      subscription_id: sub.subscriptionId,
      name: `EchoNote ${planId.toUpperCase()}`,
      description: `${billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1)} Subscription`,
      handler: async (response: any) => {
        try {
          const verifyResp = await apiFetch(getApiUrl("/api/verify-payment"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_signature: response.razorpay_signature,
              planId: sub.planId || planId,
              billingCycle: sub.billingCycle || billingCycle
            })
          });
          const result = await safeApiJson<{ success: boolean; error?: string }>(verifyResp);

          if (result.success) {
            toast.success(`Welcome to EchoNote ${planId.charAt(0).toUpperCase() + planId.slice(1)}!`);
            setTimeout(() => {
              window.location.reload();
            }, 800);
          } else {
            toast.error(result.error || "Payment verification failed.");
          }
        } catch (verifyErr: any) {
          console.error("Payment verification error:", verifyErr);
          toast.error(verifyErr.message || "Failed to verify subscription payment. Please contact support.");
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

    const rzp = new (window as any).Razorpay(options);
    rzp.on('payment.failed', (response: any) => {
      console.error("Razorpay subscription payment failed:", response.error);
      toast.error(`Payment failed: ${response.error.description || response.error.reason || 'Unknown error'}`);
    });
    rzp.open();
  } catch (err: any) {
    console.error("handleUpgrade error:", err);
    toast.error(err.message || "Failed to start subscription process.");
  }
};

/**
 * Handle Minutes Top-Up (One-time purchase)
 * Authoritatively creates a Razorpay Order via POST /api/create-order
 */
export const handleTopup = async (
  userId: string, 
  email: string, 
  displayName: string, 
  minutes: number, 
  price: number
) => {
  if (!userId) {
    toast.error("Please sign in to top-up.");
    return;
  }

  if (typeof (window as any).Razorpay === 'undefined') {
    toast.error("Razorpay payment checkout failed to load. Please check your internet connection or disable ad-blockers and try again.");
    return;
  }

  try {
    const resp = await apiFetch(getApiUrl("/api/create-order"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        type: 'topup',
        minutes
      })
    });
    const order = await safeApiJson<{ id: string; key: string; amount: number; currency: string }>(resp);

    const options = {
      key: order.key,
      amount: order.amount,
      currency: order.currency || "INR",
      name: "Minutes Top-Up",
      description: `Add ${minutes} transcription minutes`,
      order_id: order.id,
      handler: async (response: any) => {
        try {
          const verifyResp = await apiFetch(getApiUrl("/api/verify-payment"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              type: 'topup',
              minutes
            })
          });
          const result = await safeApiJson<{ success: boolean; error?: string }>(verifyResp);
          if (result.success) {
            toast.success(`Successfully added ${minutes} minutes to your balance!`);
            setTimeout(() => {
              window.location.reload();
            }, 800);
          } else {
            toast.error(result.error || "Payment verification failed.");
          }
        } catch (verifyErr: any) {
          console.error("Topup verification error:", verifyErr);
          toast.error(verifyErr.message || "Payment verification failed. Please contact support.");
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

    const rzp = new (window as any).Razorpay(options);
    rzp.on('payment.failed', (response: any) => {
      toast.error(`Payment failed: ${response.error?.description || 'Transaction cancelled'}`);
    });
    rzp.open();
  } catch (err: any) {
    console.error("handleTopup error:", err);
    toast.error(err.message || "Failed to start top-up process.");
  }
};

/**
 * Handle Thinking Top-Up (One-time purchase)
 * Authoritatively creates a Razorpay Order via POST /api/create-order
 */
export const handleThinkingTopup = async (
  userId: string, 
  email: string, 
  displayName: string, 
  requests: number, 
  price: number
) => {
  if (!userId) {
    toast.error("Please sign in to top-up.");
    return;
  }

  if (typeof (window as any).Razorpay === 'undefined') {
    toast.error("Razorpay payment checkout failed to load. Please check your internet connection or disable ad-blockers and try again.");
    return;
  }

  try {
    const resp = await apiFetch(getApiUrl("/api/create-order"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        type: 'thinking-topup',
        requests
      })
    });
    const order = await safeApiJson<{ id: string; key: string; amount: number; currency: string }>(resp);

    const options = {
      key: order.key,
      amount: order.amount,
      currency: order.currency || "INR",
      name: "AI Request Top-Up",
      description: `Add ${requests} AI Requests`,
      order_id: order.id,
      handler: async (response: any) => {
        try {
          const verifyResp = await apiFetch(getApiUrl("/api/verify-payment"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              type: 'thinking-topup',
              requests
            })
          });
          const result = await safeApiJson<{ success: boolean; error?: string }>(verifyResp);
          if (result.success) {
            toast.success(`Successfully added ${requests} AI Requests!`);
            setTimeout(() => {
              window.location.reload();
            }, 800);
          } else {
            toast.error(result.error || "Payment verification failed.");
          }
        } catch (verifyErr: any) {
          console.error("Thinking topup verification error:", verifyErr);
          toast.error(verifyErr.message || "Payment verification failed. Please contact support.");
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

    const rzp = new (window as any).Razorpay(options);
    rzp.on('payment.failed', (response: any) => {
      toast.error(`Payment failed: ${response.error?.description || 'Transaction cancelled'}`);
    });
    rzp.open();
  } catch (err: any) {
    console.error("handleThinkingTopup error:", err);
    toast.error(err.message || "Failed to start payment process.");
  }
};

/**
 * Handle Plan Downgrade
 * Authoritatively executes via POST /api/downgrade-plan.
 * Server validates plan hierarchy and updates user profile in Firestore.
 */
export const handleDowngradePlan = async (userId: string, targetPlanId: string) => {
  if (!userId) {
    toast.error("Please sign in to manage your plan.");
    return false;
  }
  try {
    const resp = await apiFetch(getApiUrl("/api/downgrade-plan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPlanId })
    });
    await safeApiJson(resp);

    toast.success(`Successfully downgraded to ${targetPlanId.charAt(0).toUpperCase() + targetPlanId.slice(1)} plan!`);
    setTimeout(() => {
      window.location.reload();
    }, 1200);
    return true;
  } catch (error: any) {
    console.error("Error downgrading plan:", error);
    toast.error(error.message || "Failed to downgrade plan. Please try again.");
    return false;
  }
};

export const handleDowngradeToFree = async (userId: string) => {
  return handleDowngradePlan(userId, 'free');
};
