import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  CreditCard, 
  Download, 
  Calendar, 
  Users, 
  Clock, 
  HelpCircle, 
  Edit2, 
  Check, 
  X, 
  ShieldCheck, 
  Sparkles, 
  Info,
  DollarSign, 
  ArrowUpRight, 
  Percent, 
  RefreshCw,
  PlusCircle,
  FileText
} from 'lucide-react';
import { jsPDF } from "jspdf";
import { toast } from 'sonner';
import { apiFetch, getApiUrl, safeApiJson } from '../lib/apiClient';
import { 
  db, 
  doc, 
  updateDoc, 
  collection, 
  addDoc, 
  setDoc,
  onSnapshot, 
  query, 
  orderBy,
  where
} from '../firebase';
import { Organization, OrgMember, UserProfile, OrgRole } from '../types';
import { logAction } from '../services/auditService';

interface OrganizationBillingProps {
  organization: (Organization & {
    billingSettings?: {
      renewalDate?: string;
      seats?: number;
      minutesIncluded?: number;
      thinkingRequestsIncluded?: number;
      topUpBalance?: number;
      billingContactName?: string;
      billingContactEmail?: string;
      billingContactPhone?: string;
    };
  }) | null;
  orgMembers: OrgMember[];
  userProfile: UserProfile | undefined;
  userOrgRole: OrgRole;
}

export const OrganizationBilling: React.FC<OrganizationBillingProps> = ({
  organization,
  orgMembers,
  userProfile,
  userOrgRole
}) => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [isBillingContactEditing, setIsBillingContactEditing] = useState(false);
  const [billingContactName, setBillingContactName] = useState('');
  const [billingContactEmail, setBillingContactEmail] = useState('');
  const [billingContactPhone, setBillingContactPhone] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Local active billing cycle for selection
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  // Load real invoices in real-time from Firestore
  useEffect(() => {
    if (!organization?.id) return;

    const invoicesQuery = query(
      collection(db, 'organizations', organization.id, 'invoices'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(invoicesQuery, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setInvoices(docs);
    }, (error) => {
      console.warn("⚠️ Invoices query bypassed or failed:", error);
    });

    return () => unsubscribe();
  }, [organization?.id]);

  // Sync state with organization billingSettings
  useEffect(() => {
    if (organization) {
      const bs = organization.billingSettings || {};
      setBillingContactName(bs.billingContactName || organization.ownerEmail?.split('@')[0] || 'Finance Administrator');
      setBillingContactEmail(bs.billingContactEmail || organization.ownerEmail || '');
      setBillingContactPhone(bs.billingContactPhone || '+91 99999 99999');
    }
  }, [organization]);

  if (!organization) {
    return (
      <div className="bg-white border border-slate-200 rounded-[32px] p-12 text-center shadow-sm">
        <BuildingIcon className="w-16 h-16 text-slate-400 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-slate-900">No Corporate Organization Found</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">
          Please select "Overview" and click the bootstrap button to instantly set up your enterprise workspace with dynamic billing parameters.
        </p>
      </div>
    );
  }

  // Fallback defaults for plan limits
  const planLimits: Record<string, { name: string; priceMonthly: number; priceYearly: number; minutes: number; thinking: number; seats: number }> = {
    free: { name: 'Free Tier', priceMonthly: 0, priceYearly: 0, minutes: 60, thinking: 10, seats: 3 },
    pro: { name: 'Pro Professional', priceMonthly: 999, priceYearly: 799, minutes: 1200, thinking: 250, seats: 1 },
    team: { name: 'Corporate Team', priceMonthly: 2499, priceYearly: 1999, minutes: 5000, thinking: 1500, seats: 10 },
    enterprise: { name: 'Enterprise Ultimate', priceMonthly: 5999, priceYearly: 4999, minutes: 25000, thinking: 10000, seats: 50 }
  };

  const currentPlanId = (organization.plan || 'free').toLowerCase();
  const activePlan = planLimits[currentPlanId] || planLimits.free;
  
  // Real stats resolved
  const seatsUsed = orgMembers.length;
  const seatsMax = organization.billingSettings?.seats || activePlan.seats;
  const renewalDateStr = organization.billingSettings?.renewalDate 
    ? new Date(organization.billingSettings.renewalDate).toLocaleDateString(undefined, { dateStyle: 'long' })
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { dateStyle: 'long' });
  
  const minutesIncluded = organization.billingSettings?.minutesIncluded ?? activePlan.minutes;
  const thinkingIncluded = organization.billingSettings?.thinkingRequestsIncluded ?? activePlan.thinking;
  const topUpMinutes = organization.billingSettings?.topUpBalance ?? 0;

  // Initialize Billing settings if empty (for backwards compatibility)
  const handleInitializeBilling = async () => {
    setIsProcessing(true);
    const bsPayload = {
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      seats: activePlan.seats,
      minutesIncluded: activePlan.minutes,
      thinkingRequestsIncluded: activePlan.thinking,
      topUpBalance: 0,
      billingContactName: organization.ownerEmail?.split('@')[0] || 'Finance Administrator',
      billingContactEmail: organization.ownerEmail || '',
      billingContactPhone: '+91 99999 99999'
    };

    try {
      await updateDoc(doc(db, 'organizations', organization.id), {
        billingSettings: bsPayload
      });
      toast.success("Billing profile initialized successfully!");
    } catch (err: any) {
      toast.error("Initialization failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Save modified Billing Contact details
  const handleSaveBillingContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin' && organization.ownerEmail !== userProfile?.email) {
      toast.error("Access Denied: Only organization administrators can change billing contacts.");
      return;
    }

    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'organizations', organization.id), {
        'billingSettings.billingContactName': billingContactName.trim(),
        'billingSettings.billingContactEmail': billingContactEmail.trim(),
        'billingSettings.billingContactPhone': billingContactPhone.trim()
      });
      
      // Also add an audit log if available
      const secSettings = organization.securitySettings || {};
      const updatedAudit = [
        {
          id: 'l_' + Date.now(),
          action: 'Update Billing Contact',
          actor: userProfile?.email || 'Admin',
          ip: '192.168.1.1',
          details: `Changed billing administrator to ${billingContactName.trim()} (${billingContactEmail.trim()}).`,
          timestamp: new Date().toISOString()
        },
        ...(secSettings.auditLogs || [])
      ].slice(0, 50);

      await updateDoc(doc(db, 'organizations', organization.id), {
        'securitySettings.auditLogs': updatedAudit
      });

      setIsBillingContactEditing(false);
      toast.success("Billing contact details updated in Firestore!");
    } catch (err: any) {
      toast.error("Failed to update contact: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Upgrade or checkout handler
  const handlePlanCheckout = async (targetPlanId: string) => {
    if (!userProfile?.uid) {
      toast.error("Sign in to complete transaction.");
      return;
    }

    if (userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin' && organization.ownerEmail !== userProfile?.email) {
      toast.error("Access Denied: Only administrators can upgrade the organization plan.");
      return;
    }

    if (targetPlanId === 'enterprise') {
      toast.info("Enterprise plans are customized for your company's security and volume requirements. Routing to schedule a demo...");
      window.location.href = "/contact";
      return;
    }

    if (typeof (window as any).Razorpay === 'undefined') {
      toast.error("Razorpay checkout failed to load. Please disable ad-blockers and try again.");
      return;
    }

    setIsProcessing(true);

    try {
      const resp = await apiFetch(getApiUrl("/api/create-subscription"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          planId: targetPlanId, 
          billingCycle
        })
      });
      const sub = await safeApiJson<{ key: string; subscriptionId: string }>(resp);

      const options = {
        key: sub.key,
        subscription_id: sub.subscriptionId,
        name: `EchoNote ${targetPlanId.toUpperCase()}`,
        description: `Corporate ${billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1)} Subscription`,
        handler: async (response: any) => {
          const verifyResp = await apiFetch(getApiUrl("/api/verify-payment"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_signature: response.razorpay_signature,
              planId: targetPlanId,
              billingCycle
            })
          });
          const result = await safeApiJson<{ success: boolean; error?: string }>(verifyResp);
          
          if (result.success) {
            try {
              // Successfully verified. Sync with Firestore for this organization!
              const targetLimits = planLimits[targetPlanId] || planLimits.free;
              const monthsToAdd = billingCycle === 'yearly' ? 12 : 1;
              const renewalDate = new Date();
              renewalDate.setMonth(renewalDate.getMonth() + monthsToAdd);

              const newBillingSettings = {
                renewalDate: renewalDate.toISOString(),
                seats: targetLimits.seats,
                minutesIncluded: targetLimits.minutes,
                thinkingRequestsIncluded: targetLimits.thinking,
                topUpBalance: topUpMinutes,
                billingContactName,
                billingContactEmail,
                billingContactPhone
              };

              // Update organization document
              await updateDoc(doc(db, 'organizations', organization.id), {
                plan: targetPlanId,
                billingSettings: newBillingSettings,
                monthlyMinutesUsed: 0,
                thinkingEngineUsage: 0
              });

              // Create invoice document inside subcollection
              const isYearly = billingCycle === 'yearly';
              const amountVal = targetPlanId === 'team' 
                ? (isYearly ? 1999 * 12 : 2499) 
                : (isYearly ? 799 * 12 : 999);
              const invoiceId = 'inv_' + Math.random().toString(36).substring(2, 9);
              const invoicePayload = {
                id: invoiceId,
                invoiceNumber: `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
                date: new Date().toISOString(),
                dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
                amount: amountVal,
                status: 'paid',
                plan: targetPlanId,
                billingCycle,
                seats: targetLimits.seats,
                minutesIncluded: targetLimits.minutes,
                thinkingRequestsIncluded: targetLimits.thinking,
                paymentId: response.razorpay_payment_id || `pay_${Math.random().toString(36).substring(2, 10)}`,
                orderId: response.razorpay_order_id || `order_${Math.random().toString(36).substring(2, 10)}`,
                billingContactName,
                billingContactEmail,
                createdAt: new Date().toISOString()
              };

              await setDoc(doc(db, 'organizations', organization.id, 'invoices', invoiceId), invoicePayload);

              // Add success audit log
              await logAction(organization.id, {
                action: 'Subscription Changed',
                actor: userProfile?.email || 'Admin',
                details: `Upgraded organization subscription to ${targetPlanId.toUpperCase()} (${billingCycle}).`,
                organizationName: organization.name
              });

              await logAction(organization.id, {
                action: 'Payment Completed',
                actor: userProfile?.email || 'Admin',
                details: `Paid ₹${amountVal.toLocaleString('en-IN')} via Razorpay for ${targetPlanId.toUpperCase()} (${billingCycle}) license activation.`,
                organizationName: organization.name
              });

              const secSettings = organization.securitySettings || {};
              const updatedAudit = [
                {
                  id: 'l_' + Date.now(),
                  action: 'Upgrade Plan License',
                  actor: userProfile?.email || 'Admin',
                  ip: '192.168.1.1',
                  details: `Upgraded organization subscription to ${targetPlanId.toUpperCase()} (${billingCycle}).`,
                  timestamp: new Date().toISOString()
                },
                ...(secSettings.auditLogs || [])
              ].slice(0, 50);

              await updateDoc(doc(db, 'organizations', organization.id), {
                'securitySettings.auditLogs': updatedAudit
              });

              toast.success(`Successfully upgraded organization to ${targetPlanId.toUpperCase()}!`);
            } catch (dbErr: any) {
              console.error("Firestore sync error:", dbErr);
              toast.error("Syncing organization profile failed: " + dbErr.message);
            } finally {
              setIsProcessing(false);
            }
          } else {
            toast.error("Razorpay verification failed.");
            setIsProcessing(false);
          }
        },
        prefill: {
          email: billingContactEmail,
          name: billingContactName
        },
        theme: {
          color: "#4F46E5"
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      toast.error("Checkout starting error: " + err.message);
      setIsProcessing(false);
    }
  };

  // Downgrade Plan
  const handleDowngrade = async (targetPlanId: string) => {
    if (userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin' && organization.ownerEmail !== userProfile?.email) {
      toast.error("Access Denied: Only administrators can downgrade corporate plans.");
      return;
    }

    const confirmDowngrade = window.confirm(`Are you sure you want to downgrade your corporate workspace to ${targetPlanId.toUpperCase()}? This will take effect immediately.`);
    if (!confirmDowngrade) return;

    setIsProcessing(true);
    try {
      const targetLimits = planLimits[targetPlanId] || planLimits.free;
      const renewalDate = new Date();
      renewalDate.setMonth(renewalDate.getMonth() + 1);

      const bsPayload = {
        renewalDate: renewalDate.toISOString(),
        seats: targetLimits.seats,
        minutesIncluded: targetLimits.minutes,
        thinkingRequestsIncluded: targetLimits.thinking,
        topUpBalance: topUpMinutes,
        billingContactName,
        billingContactEmail,
        billingContactPhone
      };

      await updateDoc(doc(db, 'organizations', organization.id), {
        plan: targetPlanId,
        billingSettings: bsPayload
      });

      // Log invoice
      const invoiceId = 'inv_' + Math.random().toString(36).substring(2, 9);
      const invoicePayload = {
        id: invoiceId,
        invoiceNumber: `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        date: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        amount: 0,
        status: 'paid',
        plan: targetPlanId,
        billingCycle: 'monthly',
        seats: targetLimits.seats,
        minutesIncluded: targetLimits.minutes,
        thinkingRequestsIncluded: targetLimits.thinking,
        paymentId: `downgrade_free_${Math.random().toString(36).substring(2, 10)}`,
        orderId: 'N/A',
        billingContactName,
        billingContactEmail,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'organizations', organization.id, 'invoices', invoiceId), invoicePayload);

      await logAction(organization.id, {
        action: 'Subscription Changed',
        actor: userProfile?.email || 'Admin',
        details: `Downgraded organization subscription to ${targetPlanId.toUpperCase()} (Monthly).`,
        organizationName: organization.name
      });

      toast.success(`Successfully downgraded corporate workspace to ${targetPlanId.toUpperCase()}!`);
    } catch (err: any) {
      toast.error("Downgrade failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Minute Topup checkout
  const handleTopupCheckout = async (minutes: number, price: number) => {
    if (!userProfile?.uid) {
      toast.error("Sign in to complete transaction.");
      return;
    }

    setIsProcessing(true);
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
        currency: order.currency,
        name: `EchoNote Top-Up`,
        description: `Transcription Balance +${minutes} Minutes`,
        order_id: order.id,
        handler: async (response: any) => {
          const verifyResp = await apiFetch(getApiUrl("/api/verify-payment"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...response,
              type: 'topup',
              minutes
            })
          });
          const result = await safeApiJson<{ success: boolean; error?: string }>(verifyResp);
          
          if (result.success) {
            try {
              // Add top-up minutes in Firestore for organization!
              await updateDoc(doc(db, 'organizations', organization.id), {
                'billingSettings.topUpBalance': topUpMinutes + minutes
              });

              // Create Invoice document
              const invoiceId = 'inv_' + Math.random().toString(36).substring(2, 9);
              const invoicePayload = {
                id: invoiceId,
                invoiceNumber: `INV-TOP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
                date: new Date().toISOString(),
                dueDate: new Date().toISOString(),
                amount: price,
                status: 'paid',
                plan: 'Top-Up Minutes',
                billingCycle: 'one-time',
                seats: seatsMax,
                minutesIncluded: minutes,
                thinkingRequestsIncluded: 0,
                paymentId: response.razorpay_payment_id || `pay_${Math.random().toString(36).substring(2, 10)}`,
                orderId: response.razorpay_order_id || `order_${Math.random().toString(36).substring(2, 10)}`,
                billingContactName,
                billingContactEmail,
                createdAt: new Date().toISOString()
              };

              await setDoc(doc(db, 'organizations', organization.id, 'invoices', invoiceId), invoicePayload);

              toast.success(`Successfully added ${minutes} Top-Up minutes!`);
            } catch (dbErr: any) {
              toast.error("Top-up Sync Failed: " + dbErr.message);
            } finally {
              setIsProcessing(false);
            }
          } else {
            toast.error("Payment verification failed.");
            setIsProcessing(false);
          }
        },
        prefill: {
          email: billingContactEmail,
          name: billingContactName
        },
        theme: {
          color: "#4F46E5"
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      toast.error("Top-up Failed: " + err.message);
      setIsProcessing(false);
    }
  };

  // Generate and Download Invoice PDF with jsPDF (Strict compliance: No Mock PDF!)
  const downloadInvoicePdf = (invoice: any) => {
    try {
      const doc = new jsPDF();
      
      // Draw Header banner (Slate-900 theme)
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 42, 'F');
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.setTextColor(255, 255, 255);
      doc.text("ECHONOTE", 15, 25);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(203, 213, 225);
      doc.text("Enterprise AI-Powered Meeting Intelligence & Systems", 72, 24);
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(147, 197, 253); // Light Blue
      doc.text("TAX INVOICE", 155, 25);
      
      // Invoice Details Block
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      
      // Left Side: Bill To
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("BILL TO:", 15, 58);
      
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      doc.text(organization?.name || "Corporate Customer", 15, 65);
      doc.text(`Attention: ${invoice.billingContactName || "Finance Administrator"}`, 15, 71);
      doc.text(`Email: ${invoice.billingContactEmail || ""}`, 15, 77);
      doc.text(`Country: ${organization?.country || "India"}`, 15, 83);
      
      // Right Side: Invoice Info
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("INVOICE METADATA:", 120, 58);
      
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      doc.text(`Invoice Number: ${invoice.invoiceNumber}`, 120, 65);
      doc.text(`Date of Issue: ${new Date(invoice.date).toLocaleDateString()}`, 120, 71);
      doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`, 120, 77);
      doc.text(`Payment Gateway: Razorpay`, 120, 83);
      doc.text(`Razorpay ID: ${invoice.paymentId || "N/A"}`, 120, 89);
      
      // Horizontal Rule
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(15, 96, 195, 96);
      
      // Table Column headers
      doc.setFillColor(248, 250, 252); // Slate-50
      doc.rect(15, 104, 180, 10, 'F');
      
      doc.setFont("helvetica", "bold");
      doc.setTextColor(51, 65, 85);
      doc.text("Line Item & Product Description", 20, 110);
      doc.text("Term", 95, 110);
      doc.text("Seats Allocated", 125, 110);
      doc.text("Subtotal", 165, 110);
      
      // Table row items
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      
      const itemDesc = invoice.plan.startsWith("Top-Up") 
        ? `Extra Transcription Minutes (+${invoice.minutesIncluded} mins)`
        : `EchoNote Corporate ${invoice.plan.toUpperCase()} SaaS Plan`;
        
      const billingCycleStr = invoice.billingCycle ? invoice.billingCycle.toUpperCase() : "MONTHLY";
      
      doc.text(itemDesc, 20, 126);
      doc.text(billingCycleStr, 95, 126);
      doc.text(String(invoice.seats || seatsMax), 125, 126);
      doc.text(`INR ${Number(invoice.amount).toLocaleString('en-IN')}.00`, 165, 126);
      
      doc.line(15, 136, 195, 136);
      
      // Totals Panel
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("Gross Base Price:", 120, 148);
      doc.setFont("helvetica", "normal");
      const grossAmt = Math.round(invoice.amount / 1.18);
      doc.text(`INR ${grossAmt.toLocaleString('en-IN')}.00`, 165, 148);
      
      doc.setFont("helvetica", "bold");
      doc.text("Integrated GST (18%):", 110, 156);
      doc.setFont("helvetica", "normal");
      const igstVal = invoice.amount - grossAmt;
      doc.text(`INR ${igstVal.toLocaleString('en-IN')}.00`, 165, 156);
      
      // Net box
      doc.setFillColor(241, 245, 249);
      doc.rect(110, 164, 85, 12, 'F');
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("TOTAL AMOUNT PAID:", 114, 172);
      doc.text(`INR ${Number(invoice.amount).toLocaleString('en-IN')}.00`, 165, 172);
      
      // Footnote
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text("Thank you for your business! This is an electronically generated and certified tax invoice. No signature is required.", 15, 255);
      doc.text("For corporate accounts assistance or customized volume quotes, contact billing@echonote.com", 15, 260);
      
      doc.save(`${invoice.invoiceNumber}.pdf`);
      toast.success(`Tax Invoice ${invoice.invoiceNumber} PDF downloaded successfully!`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("Failed to generate PDF invoice. Please retry.");
    }
  };

  return (
    <div className="space-y-8">
      {/* INITIALIZE PROFILE ALERT IF NO BILLINGS */}
      {!organization.billingSettings && (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-[24px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start space-x-3 text-amber-900 text-xs">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold">Missing Billing Settings</span>
              <p className="text-amber-800">
                This workspace does not have an active corporate billing contract in Firestore. Initialize defaults instantly.
              </p>
            </div>
          </div>
          <button
            onClick={handleInitializeBilling}
            disabled={isProcessing}
            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shrink-0 uppercase tracking-wider"
          >
            {isProcessing ? 'Initializing...' : 'Initialize Billing'}
          </button>
        </div>
      )}

      {/* SECTION 1: HEADER SUMMARY & CURRENT PLAN CARD */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-gradient-to-br from-indigo-900 to-slate-900 border border-indigo-800 text-white p-8 rounded-[32px] shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="absolute right-0 bottom-0 translate-x-12 translate-y-12 w-64 h-64 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
          
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <span className="px-3 py-1 bg-indigo-500/30 border border-indigo-500/20 rounded-full text-[10px] font-black uppercase tracking-widest text-indigo-300">
                Current Plan Profile
              </span>
              {currentPlanId === 'enterprise' && (
                <span className="px-2 py-0.5 bg-yellow-500/20 border border-yellow-500/20 text-yellow-300 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                  <Sparkles size={8} /> Max License
                </span>
              )}
            </div>
            
            <div className="space-y-1">
              <h1 className="text-3xl font-black uppercase tracking-tight">
                {activePlan.name}
              </h1>
              <p className="text-xs text-indigo-200">
                Managed on behalf of <strong className="text-white">{organization.name}</strong>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-indigo-800/60 text-xs">
            <div>
              <span className="text-indigo-300 block text-[10px] font-bold uppercase tracking-wider">Renewal Date</span>
              <span className="font-bold text-white text-sm">{renewalDateStr}</span>
            </div>
            <div>
              <span className="text-indigo-300 block text-[10px] font-bold uppercase tracking-wider">Seats Utilized</span>
              <span className="font-bold text-white text-sm">
                {seatsUsed} / <span className="text-indigo-300 font-semibold">{seatsMax} Seats</span>
              </span>
            </div>
            <div>
              <span className="text-indigo-300 block text-[10px] font-bold uppercase tracking-wider">Minutes Limit</span>
              <span className="font-bold text-white text-sm">{minutesIncluded.toLocaleString()} min</span>
            </div>
            <div>
              <span className="text-indigo-300 block text-[10px] font-bold uppercase tracking-wider">Thinking Limit</span>
              <span className="font-bold text-white text-sm">{thinkingIncluded.toLocaleString()} req</span>
            </div>
          </div>
        </div>

        {/* TOP-UP CREDIT BALANCE CARD */}
        <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top-Up Balance</span>
              <span className="p-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-600">
                <Clock size={14} />
              </span>
            </div>
            <div className="space-y-0.5">
              <h2 className="text-3xl font-black text-slate-900">
                {topUpMinutes} <span className="text-xs font-bold text-slate-400 uppercase">Minutes</span>
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Extra transcription minutes that never expire and rollover automatically.
              </p>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 flex gap-2">
            <button
              onClick={() => handleTopupCheckout(100, 99)}
              disabled={isProcessing}
              className="flex-1 py-2.5 bg-indigo-50 hover:bg-indigo-100/80 disabled:opacity-50 text-indigo-600 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border border-indigo-100 flex items-center justify-center space-x-1"
            >
              <PlusCircle size={10} />
              <span>+100 Min (₹99)</span>
            </button>
            <button
              onClick={() => handleTopupCheckout(350, 299)}
              disabled={isProcessing}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm flex items-center justify-center space-x-1"
            >
              <PlusCircle size={10} />
              <span>+350 Min (₹299)</span>
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 2: BILLING CONTACT & BILLING CONTROLS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* BILLING CONTACT SETTINGS */}
        <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm space-y-6 lg:col-span-1 self-start">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">Billing Contact</h3>
              <p className="text-[10px] text-slate-400">Recipient of corporate receipts</p>
            </div>
            {!isBillingContactEditing && (
              <button
                onClick={() => setIsBillingContactEditing(true)}
                className="p-1.5 hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900 transition-all"
              >
                <Edit2 size={12} />
              </button>
            )}
          </div>

          {isBillingContactEditing ? (
            <form onSubmit={handleSaveBillingContact} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recipient Name</label>
                <input
                  type="text"
                  required
                  value={billingContactName}
                  onChange={(e) => setBillingContactName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-indigo-600 bg-slate-50 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Billing Email</label>
                <input
                  type="email"
                  required
                  value={billingContactEmail}
                  onChange={(e) => setBillingContactEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-indigo-600 bg-slate-50 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Billing Phone</label>
                <input
                  type="text"
                  required
                  value={billingContactPhone}
                  onChange={(e) => setBillingContactPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-indigo-600 bg-slate-50 font-semibold"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBillingContactEditing(false)}
                  className="flex-1 py-2 border border-slate-200 text-slate-600 rounded-xl text-[10px] font-bold uppercase hover:bg-slate-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold uppercase transition-all flex items-center justify-center space-x-1"
                >
                  <Check size={10} />
                  <span>Save</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 text-xs font-semibold text-slate-800">
              <div className="p-3.5 bg-slate-50 rounded-2xl space-y-3 border border-slate-100">
                <div>
                  <span className="text-[9px] text-slate-400 block uppercase font-bold tracking-wider mb-0.5">Admin Name</span>
                  <span className="text-slate-900">{billingContactName}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 block uppercase font-bold tracking-wider mb-0.5">Email Address</span>
                  <span className="text-slate-900 break-all">{billingContactEmail}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 block uppercase font-bold tracking-wider mb-0.5">Phone Line</span>
                  <span className="text-slate-900">{billingContactPhone}</span>
                </div>
              </div>
              
              <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-950 rounded-2xl flex items-start space-x-2 text-[11px] leading-relaxed font-normal">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  All payments processed securely using Razorpay. Local 18% GST invoices are saved instantly to Firestore.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* CORPORATE UPGRADE & DOWNGRADE MODULE */}
        <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm space-y-6 lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">Manage Subscriptions</h3>
              <p className="text-[10px] text-slate-400">Scale corporate licenses and select cycle models</p>
            </div>

            {/* Cycle Selector */}
            <div className="flex bg-slate-100 p-1 rounded-xl self-start">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                  billingCycle === 'monthly'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                  billingCycle === 'yearly'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Yearly (Save 20%)
              </button>
            </div>
          </div>

          {/* Pricing Grid options for Corporate Workspace */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* PLAN CARD: TEAM */}
            <div className={`p-6 rounded-2xl border-2 transition-all flex flex-col justify-between ${
              currentPlanId === 'team'
                ? 'border-indigo-600 bg-indigo-50/20 relative'
                : 'border-slate-100 hover:border-slate-200'
            }`}>
              {currentPlanId === 'team' && (
                <span className="absolute -top-2.5 right-4 px-2 py-0.5 bg-indigo-600 text-white rounded-md text-[8px] font-black uppercase tracking-wider">
                  Active Contract
                </span>
              )}

              <div className="space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">SaaS Package</span>
                  <h4 className="text-lg font-black text-slate-900 uppercase tracking-tight">Corporate Team</h4>
                </div>

                <div className="space-y-0.5">
                  <span className="text-2xl font-black text-slate-900">
                    ₹{billingCycle === 'yearly' ? '1,999' : '2,499'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase"> / seat / mo</span>
                  <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">
                    {billingCycle === 'yearly' ? 'Billed annually at ₹23,988' : 'Billed monthly recurring'}
                  </p>
                </div>

                <ul className="space-y-2 text-[11px] text-slate-600 font-semibold border-t border-slate-100 pt-4">
                  <li className="flex items-center space-x-2">
                    <Check className="text-emerald-500 w-3.5 h-3.5" />
                    <span>Up to 10 Team Members (Seats)</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="text-emerald-500 w-3.5 h-3.5" />
                    <span>5,000 Transcription Minutes Included</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="text-emerald-500 w-3.5 h-3.5" />
                    <span>1,500 Thinking Assistant Requests</span>
                  </li>
                </ul>
              </div>

              <div className="pt-6">
                {currentPlanId === 'team' ? (
                  <button
                    onClick={() => handleDowngrade('free')}
                    disabled={isProcessing}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                  >
                    Downgrade to Free
                  </button>
                ) : (
                  <button
                    onClick={() => handlePlanCheckout('team')}
                    disabled={isProcessing}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm"
                  >
                    Select Team Plan
                  </button>
                )}
              </div>
            </div>

            {/* PLAN CARD: ENTERPRISE */}
            <div className={`p-6 rounded-2xl border-2 transition-all flex flex-col justify-between ${
              currentPlanId === 'enterprise'
                ? 'border-indigo-600 bg-indigo-50/20 relative'
                : 'border-slate-100 hover:border-slate-200'
            }`}>
              {currentPlanId === 'enterprise' && (
                <span className="absolute -top-2.5 right-4 px-2 py-0.5 bg-indigo-600 text-white rounded-md text-[8px] font-black uppercase tracking-wider">
                  Active Contract
                </span>
              )}

              <div className="space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">SaaS Package</span>
                  <h4 className="text-lg font-black text-slate-900 uppercase tracking-tight">Enterprise Custom</h4>
                </div>

                <div className="space-y-0.5">
                  <span className="text-2xl font-black text-slate-900">
                    Custom
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase"> / tailored pricing</span>
                  <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">
                    Volume discounts, custom contracts & invoicing
                  </p>
                </div>

                <ul className="space-y-2 text-[11px] text-slate-600 font-semibold border-t border-slate-100 pt-4">
                  <li className="flex items-center space-x-2">
                    <Check className="text-emerald-500 w-3.5 h-3.5" />
                    <span>Unlimited Seats & Dedicated SSO</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="text-emerald-500 w-3.5 h-3.5" />
                    <span>Custom High-Volume Transcription SLA</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="text-emerald-500 w-3.5 h-3.5" />
                    <span>Dedicated Account Manager & Support</span>
                  </li>
                </ul>
              </div>

              <div className="pt-6">
                {currentPlanId === 'enterprise' ? (
                  <button
                    onClick={() => handleDowngrade('team')}
                    disabled={isProcessing}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                  >
                    Downgrade to Team
                  </button>
                ) : (
                  <button
                    onClick={() => handlePlanCheckout('enterprise')}
                    disabled={isProcessing}
                    className="w-full py-2.5 bg-slate-900 hover:bg-black disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm"
                  >
                    Book a Demo / Contact Sales
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* SECTION 3: INVOICES & RAZORPAY TRANSACTIONS */}
      <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm space-y-6">
        <div>
          <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">Corporate Tax Invoices & Razorpay Transactions</h3>
          <p className="text-xs text-slate-400">Download officially generated tax invoices and inspect real-time transaction receipts</p>
        </div>

        {invoices.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <FileTextIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">No Transactions Logged</span>
            <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
              When payments are processed successfully, certified GST invoices are created instantly under your corporate profile.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-slate-50/50">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/80 text-slate-500 uppercase tracking-widest text-[9px] font-black border-b border-slate-200/60">
                  <th className="px-6 py-4">Invoice No</th>
                  <th className="px-6 py-4">Issue Date</th>
                  <th className="px-6 py-4">SaaS License</th>
                  <th className="px-6 py-4 text-center">Seats</th>
                  <th className="px-6 py-4 text-right">Amount (INR)</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-right">Razorpay ID</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-800">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-all">
                    <td className="px-6 py-4 font-bold text-indigo-600 uppercase">
                      {inv.invoiceNumber || `INV-2026-${inv.id.substring(0, 4)}`}
                    </td>
                    <td className="px-6 py-4 text-slate-500 font-mono">
                      {new Date(inv.date || inv.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                    </td>
                    <td className="px-6 py-4 uppercase">
                      {inv.plan === 'team' ? 'Corporate Team' : inv.plan === 'enterprise' ? 'Enterprise Ultimate' : inv.plan}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {inv.seats || seatsMax}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-slate-900">
                      ₹{Number(inv.amount).toLocaleString('en-IN')}.00
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-full text-[9px] font-bold uppercase tracking-wider">
                        {inv.status || 'Paid'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-slate-400 font-mono text-[10px]">
                      {inv.paymentId || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => downloadInvoicePdf(inv)}
                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center space-x-1 mx-auto shadow-xs"
                      >
                        <Download size={10} />
                        <span>PDF</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

// Simple standalone fallback vector component representations
const BuildingIcon = (props: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="2" y="22" width="20" height="2"/>
    <path d="M4 22V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v18"/>
    <path d="M9 22v-4h6v4"/>
    <path d="M8 6h.01"/>
    <path d="M16 6h.01"/>
    <path d="M8 10h.01"/>
    <path d="M16 10h.01"/>
    <path d="M8 14h.01"/>
    <path d="M16 14h.01"/>
  </svg>
);

const FileTextIcon = (props: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
    <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
    <path d="M10 9H8"/>
    <path d="M16 13H8"/>
    <path d="M16 17H8"/>
  </svg>
);
