import { auth } from '../firebase';

declare var Razorpay: any;

export const createRazorpaySubscription = async (plan: 'pro' | 'team' | 'enterprise', billingCycle: 'monthly' | 'yearly' = 'monthly') => {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  try {
    // 1. Create order on backend
    const response = await fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, billingCycle, userId: user.uid })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to create order");
    }

    const { order_id, amount, currency, key_id } = await response.json();

    // 2. Open Razorpay Checkout
    return new Promise((resolve, reject) => {
      const options = {
        key: key_id,
        amount: amount,
        currency: currency,
        name: 'EchoNote',
        description: `${plan.toUpperCase()} Plan Upgrade`,
        order_id: order_id,
        handler: async function (response: any) {
          try {
            // 3. Verify payment on backend
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                userId: user.uid,
                plan,
                billingCycle
              })
            });

            if (!verifyRes.ok) {
              const errorData = await verifyRes.json();
              throw new Error(errorData.error || "Payment verification failed");
            }

            resolve({ success: true });
          } catch (err) {
            reject(err);
          }
        },
        prefill: {
          name: user.displayName || '',
          email: user.email || '',
        },
        theme: {
          color: '#112250'
        },
        modal: {
          ondismiss: function() {
            reject(new Error("Payment cancelled"));
          }
        }
      };

      const rzp = new Razorpay(options);
      rzp.open();
    });

  } catch (error) {
    console.error("Razorpay Checkout Error:", error);
    throw error;
  }
};
