import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { collection, addDoc, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { createRazorpaySubscription } from '../services/razorpayService';

const TestDashboard: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const runFullFlow = async () => {
    setStatus('running');
    setLogs([]);
    addLog('Starting full user flow simulation...');

    try {
      // 1. Signup (Assuming user is already logged in via Firebase Auth for this test)
      const user = auth.currentUser;
      if (!user) {
        throw new Error('User not authenticated. Please sign in first.');
      }
      addLog(`User authenticated: ${user.email}`);

      // 2. Create Project
      addLog('Creating test project...');
      const functions = getFunctions();
      const createProject = httpsCallable(functions, 'createProject');
      const projectResult = await createProject({ name: 'Test Project ' + Date.now() });
      const projectId = (projectResult.data as any).projectId;
      addLog(`Project created with ID: ${projectId}`);

      // 3. Invite User
      addLog('Sending test invitation...');
      const sendInviteEmail = httpsCallable(functions, 'sendInviteEmail');
      await sendInviteEmail({
        email: 'test-invitee@example.com',
        projectId: projectId,
        role: 'editor',
        origin: window.location.origin
      });
      addLog('Invitation sent successfully (check Resend logs if configured).');

      // 4. Upgrade Plan (Trigger Razorpay Modal)
      addLog('Initiating plan upgrade (Razorpay Test Mode)...');
      addLog('Please complete the payment in the Razorpay modal that appears.');
      await createRazorpaySubscription('pro');
      
      addLog('Subscription flow initiated. Waiting for webhook/verification...');
      setStatus('completed');
    } catch (error: any) {
      addLog(`ERROR: ${error.message}`);
      setStatus('error');
    }
  };

  const testWebhook = async () => {
    setStatus('running');
    addLog('Simulating Razorpay Webhook (subscription.activated)...');
    try {
      const functions = getFunctions();
      const simulateWebhook = httpsCallable(functions, 'simulateWebhook');
      const result = await simulateWebhook({ event: 'subscription.activated', plan: 'pro' });
      addLog(`Webhook simulation successful! Subscription ID: ${(result.data as any).subscriptionId}`);
      addLog('User plan should now be updated to "pro".');
      setStatus('completed');
    } catch (error: any) {
      addLog(`ERROR: ${error.message}`);
      setStatus('error');
    }
  };

  const testEmail = async () => {
    setStatus('running');
    addLog('Testing Resend Email Integration...');
    try {
      const functions = getFunctions();
      const sendInviteEmail = httpsCallable(functions, 'sendInviteEmail');
      await sendInviteEmail({
        email: auth.currentUser?.email || 'test@example.com',
        projectId: 'test-project-id',
        role: 'editor',
        origin: window.location.origin
      });
      addLog('Test email sent successfully! Check your inbox.');
      setStatus('completed');
    } catch (error: any) {
      addLog(`ERROR: ${error.message}`);
      setStatus('error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in duration-700">
      <div className="bg-white rounded-xl p-8 shadow-sm border border-brand-divider/20 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-brand-primary">Backend Testing Dashboard</h1>
            <p className="text-slate-500">Simulate full user flows and verify Razorpay/Email integrations.</p>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`w-3 h-3 rounded-full ${
              status === 'running' ? 'bg-amber-500 animate-pulse' : 
              status === 'completed' ? 'bg-emerald-500' : 
              status === 'error' ? 'bg-red-500' : 'bg-slate-300'
            }`}></span>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">{status}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Test Scenarios</h2>
            <button 
              onClick={runFullFlow}
              disabled={status === 'running'}
              className="w-full py-4 bg-brand-primary text-white rounded-lg font-semibold tracking-widest text-[13px] shadow-xl hover:bg-brand-secondary transition-all disabled:opacity-50"
            >
              RUN FULL USER FLOW
            </button>
            <button 
              onClick={testWebhook}
              disabled={status === 'running'}
              className="w-full py-4 bg-emerald-600 text-white rounded-lg font-semibold tracking-widest text-[13px] shadow-xl hover:bg-emerald-700 transition-all disabled:opacity-50"
            >
              SIMULATE WEBHOOK (TEST)
            </button>
            <button 
              onClick={testEmail}
              disabled={status === 'running'}
              className="w-full py-4 bg-indigo-600 text-white rounded-lg font-semibold tracking-widest text-[13px] shadow-xl hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              TEST EMAIL (RESEND)
            </button>
            <div className="p-4 bg-brand-background rounded-lg border border-brand-divider/10 space-y-2">
              <p className="text-xs font-medium text-slate-600">This will simulate:</p>
              <ul className="text-[11px] text-slate-500 space-y-1 list-disc list-inside">
                <li>Project Creation</li>
                <li>User Invitation (via Resend)</li>
                <li>Razorpay Subscription Creation</li>
                <li>Payment Verification</li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Live Logs</h2>
            <div className="h-64 bg-slate-900 rounded-lg p-4 font-mono text-[11px] text-emerald-400 overflow-y-auto custom-scrollbar border border-slate-800 shadow-inner">
              {logs.length === 0 ? (
                <span className="opacity-30">Waiting for test execution...</span>
              ) : (
                logs.map((log, i) => <div key={i} className="mb-1">{log}</div>)
              )}
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-brand-divider/10">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Local Webhook Testing Guide</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-[13px]">
            <div className="space-y-3">
              <p className="font-semibold text-brand-primary">1. Expose Local Server (if developing locally)</p>
              <code className="block p-3 bg-slate-100 rounded border border-slate-200 text-slate-700">
                ngrok http 3000
              </code>
              <p className="text-slate-500 italic">Note: In this AI Studio environment, your app is already public at the App URL provided.</p>
            </div>
            <div className="space-y-3">
              <p className="font-semibold text-brand-primary">2. Configure Razorpay Webhook</p>
              <p className="text-slate-500">Set the webhook URL in Razorpay Dashboard to:</p>
              <code className="block p-3 bg-slate-100 rounded border border-slate-200 text-slate-700 break-all">
                {window.location.origin.replace('ais-dev', 'functions-url')}/razorpayWebhook
              </code>
              <p className="text-[11px] text-amber-600 font-medium">Use the actual Cloud Functions URL for your project.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestDashboard;
