
import { toast } from 'sonner';

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

    const rzp = new (window as any).Razorpay(options);
    rzp.open();
  } catch (err: any) {
    toast.error(err.message || "Failed to start top-up process.");
  }
};
