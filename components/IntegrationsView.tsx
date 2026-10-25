import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Globe, 
  Slack, 
  Video, 
  Calendar, 
  Zap, 
  Webhook, 
  Key, 
  Users, 
  Check, 
  X, 
  Settings, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Eye, 
  EyeOff, 
  Copy, 
  Info, 
  Database, 
  Power,
  Shield,
  FileText
} from 'lucide-react';
import { auth } from '../firebase';
import { logAction } from '../services/auditService';
import { getApiBaseUrl, getAuthHeaders, parseApiResponse } from '../lib/apiClient';
import { Toaster, toast } from 'sonner';

interface IntegrationsViewProps {
  organization: {
    id: string;
    name: string;
  };
  userProfile?: {
    email: string;
    uid: string;
  } | null;
}

interface IntegrationItem {
  id: string;
  name: string;
  description: string;
  category: 'productivity' | 'collaboration' | 'video' | 'developer';
  icon: React.ReactNode;
  brandColor: string;
  docsUrl: string;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({ organization, userProfile }) => {
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'productivity' | 'collaboration' | 'video' | 'developer'>('all');
  const [integrationStates, setIntegrationStates] = useState<Record<string, { enabled: boolean; status: 'connected' | 'disconnected'; config: any }>>({});
  const [loading, setLoading] = useState(true);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  // States for webhooks
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookSecret, setNewWebhookSecret] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>(['transcript.created']);

  // States for REST API Keys
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);

  // States for OAuth Clients
  const [oauthClients, setOauthClients] = useState<any[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientRedirect, setNewClientRedirect] = useState('');
  const [generatedClient, setGeneratedClient] = useState<{ id: string; secret: string } | null>(null);
  const [showClientModal, setShowClientModal] = useState(false);

  // Toggle Visibility for sensitive fields
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // Form states for general integrations configuration
  const [formData, setFormData] = useState<Record<string, any>>({});

  const availableIntegrations: IntegrationItem[] = [
    {
      id: 'google-workspace',
      name: 'Google Workspace',
      description: 'Sync and export transcripts, summaries, and smart action items directly to Google Drive & Docs.',
      category: 'productivity',
      icon: <Globe className="text-emerald-600" size={20} />,
      brandColor: 'border-l-emerald-500 bg-emerald-50/10',
      docsUrl: 'https://workspace.google.com'
    },
    {
      id: 'microsoft-365',
      name: 'Microsoft 365',
      description: 'Automate content saving to OneDrive, Sharepoint, and synchronize meeting timelines.',
      category: 'productivity',
      icon: <Calendar className="text-blue-600" size={20} />,
      brandColor: 'border-l-blue-500 bg-blue-50/10',
      docsUrl: 'https://microsoft.com/microsoft-365'
    },
    {
      id: 'slack',
      name: 'Slack',
      description: 'Send instant notifications, summaries, and critical strategic decisions to specified channels.',
      category: 'collaboration',
      icon: <Slack className="text-purple-600" size={20} />,
      brandColor: 'border-l-purple-500 bg-purple-50/10',
      docsUrl: 'https://slack.com'
    },
    {
      id: 'zoom',
      name: 'Zoom',
      description: 'Auto-import Zoom cloud recordings, generating transcripts and intelligence analysis instantly.',
      category: 'video',
      icon: <Video className="text-sky-600" size={20} />,
      brandColor: 'border-l-sky-500 bg-sky-50/10',
      docsUrl: 'https://zoom.us'
    },
    {
      id: 'google-meet',
      name: 'Google Meet',
      description: 'Leverage our real-time recorder plugin to automatically capture and process Google Meet sessions.',
      category: 'video',
      icon: <Video className="text-teal-600" size={20} />,
      brandColor: 'border-l-teal-500 bg-teal-50/10',
      docsUrl: 'https://meet.google.com'
    },
    {
      id: 'microsoft-teams',
      name: 'Microsoft Teams',
      description: 'Live-feed integration for Teams video calls, processing meetings in secure corporate workspaces.',
      category: 'video',
      icon: <Video className="text-indigo-600" size={20} />,
      brandColor: 'border-l-indigo-500 bg-indigo-50/10',
      docsUrl: 'https://microsoft.com/microsoft-teams'
    },
    {
      id: 'zapier',
      name: 'Zapier',
      description: 'Connect EchoNote to over 5,000+ apps to automate customized workflows and spreadsheets.',
      category: 'developer',
      icon: <Zap className="text-orange-500" size={20} />,
      brandColor: 'border-l-orange-500 bg-orange-50/10',
      docsUrl: 'https://zapier.com'
    },
    {
      id: 'webhooks',
      name: 'Webhooks',
      description: 'Receive real-time HTTPS POST payloads for custom triggers, meeting creations, or complete transcriptions.',
      category: 'developer',
      icon: <Webhook className="text-rose-500" size={20} />,
      brandColor: 'border-l-rose-500 bg-rose-50/10',
      docsUrl: 'https://developer.echonote.ai/webhooks'
    },
    {
      id: 'rest-api',
      name: 'REST API Keys',
      description: 'Access the complete core platform programmatically to build high-availability customized portals.',
      category: 'developer',
      icon: <Key className="text-slate-700" size={20} />,
      brandColor: 'border-l-slate-700 bg-slate-50/10',
      docsUrl: 'https://developer.echonote.ai/api-reference'
    },
    {
      id: 'oauth-clients',
      name: 'OAuth Clients',
      description: 'Register internal secure clients to perform authorization requests securely using custom OAuth 2.0 flows.',
      category: 'developer',
      icon: <Users className="text-amber-600" size={20} />,
      brandColor: 'border-l-amber-500 bg-amber-50/10',
      docsUrl: 'https://developer.echonote.ai/oauth'
    }
  ];

  // Load Configurations and state securely via authenticated server endpoints
  useEffect(() => {
    if (!organization?.id) return;

    let isMounted = true;
    setLoading(true);

    if (!auth?.currentUser) {
      // Unauthenticated / Guest Mode: clean empty integrations state
      const states: Record<string, any> = {};
      
      availableIntegrations.forEach(item => {
        states[item.id] = { enabled: false, status: 'disconnected', config: {} };
      });

      setIntegrationStates(states);
      setWebhooks([]);
      setApiKeys([]);
      setOauthClients([]);
      setLoading(false);

      return () => { isMounted = false; };
    }

    const fetchIntegrations = async () => {
      try {
        const baseUrl = getApiBaseUrl();
        const headers = await getAuthHeaders();
        const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations`, {
          headers
        });
        const parsed = await parseApiResponse(res);

        if (parsed.ok && parsed.data && parsed.data.integrations) {
          if (!isMounted) return;
          const serverIntegrations = parsed.data.integrations;
          const states: Record<string, any> = {};

          availableIntegrations.forEach(item => {
            states[item.id] = serverIntegrations[item.id] || { enabled: false, status: 'disconnected', config: {} };
          });

          setIntegrationStates(states);

          const webhooksConfig = states['webhooks']?.config?.endpoints || [];
          setWebhooks(webhooksConfig);

          const restKeysConfig = states['rest-api']?.config?.keys || [];
          setApiKeys(restKeysConfig);

          const oauthClientsConfig = states['oauth-clients']?.config?.clients || [];
          setOauthClients(oauthClientsConfig);
        } else {
          // If server returns error, populate defaults cleanly
          if (!isMounted) return;
          const states: Record<string, any> = {};
          availableIntegrations.forEach(item => {
            states[item.id] = { enabled: false, status: 'disconnected', config: {} };
          });
          setIntegrationStates(states);
        }
      } catch (err: any) {
        console.error("Error reading sanitized integrations from server:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchIntegrations();

    return () => {
      isMounted = false;
    };
  }, [organization?.id]);

  const toggleSecret = (id: string) => {
    setShowSecrets(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleIntegration = async (id: string, currentEnabled: boolean) => {
    try {
      const nextEnabled = !currentEnabled;
      const nextStatus = nextEnabled ? 'connected' : 'disconnected';
      const item = availableIntegrations.find(i => i.id === id);

      const existingConfig = integrationStates[id]?.config || {};

      if (!auth?.currentUser) {
        // Guest Mode: Update local state only
        setIntegrationStates(prev => ({
          ...prev,
          [id]: {
            ...prev[id],
            enabled: nextEnabled,
            status: nextStatus,
            config: existingConfig
          }
        }));
        toast.success(`[Simulated] "${item?.name}" integration ${nextEnabled ? 'enabled' : 'disabled'} successfully.`);
        return;
      }

      const baseUrl = getApiBaseUrl();
      const headers = await getAuthHeaders();
      const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/${id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          enabled: nextEnabled,
          status: nextStatus,
          config: existingConfig
        })
      });

      const parsed = await parseApiResponse(res);
      if (!parsed.ok) {
        throw new Error(parsed.error || "Failed to toggle integration");
      }

      setIntegrationStates(prev => ({
        ...prev,
        [id]: {
          ...prev[id],
          enabled: nextEnabled,
          status: nextStatus
        }
      }));

      await logAction(organization.id, {
        action: nextEnabled ? 'Integration Enabled' : 'Integration Disabled',
        actor: userProfile?.email || 'Admin',
        details: `${nextEnabled ? 'Enabled' : 'Disabled'} integration "${item?.name || id}".`,
        organizationName: organization.name
      });

      toast.success(`"${item?.name}" integration ${nextEnabled ? 'enabled successfully' : 'disabled successfully'}.`);
    } catch (error: any) {
      toast.error("Failed to toggle integration: " + error.message);
    }
  };

  const handleOpenConfig = (id: string) => {
    setConfiguringId(id);
    const existingConfig = integrationStates[id]?.config || {};
    setFormData(existingConfig);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuringId) return;

    try {
      const item = availableIntegrations.find(i => i.id === configuringId);

      if (!auth?.currentUser) {
        // Guest Mode: Update local state only
        setIntegrationStates(prev => ({
          ...prev,
          [configuringId]: {
            ...prev[configuringId],
            enabled: true,
            status: 'connected',
            config: formData
          }
        }));
        toast.success(`[Simulated] Successfully saved "${item?.name}" configuration!`);
        setConfiguringId(null);
        return;
      }

      const baseUrl = getApiBaseUrl();
      const headers = await getAuthHeaders();
      const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/${configuringId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          enabled: true,
          status: 'connected',
          config: formData
        })
      });

      const parsed = await parseApiResponse(res);
      if (!parsed.ok) {
        if (parsed.status === 422 && parsed.data?.error === "ENCRYPTION_KEY_REQUIRED") {
          toast.error("Server Encryption Key Required: Secret cannot be stored until INTEGRATION_ENCRYPTION_KEY is configured.");
          return;
        }
        throw new Error(parsed.error || "Failed to save configuration");
      }

      const returnedIntegration = parsed.data?.integration;
      setIntegrationStates(prev => ({
        ...prev,
        [configuringId]: {
          ...prev[configuringId],
          enabled: true,
          status: 'connected',
          config: returnedIntegration?.config || formData
        }
      }));

      await logAction(organization.id, {
        action: 'Integration Configured',
        actor: userProfile?.email || 'Admin',
        details: `Saved new configuration parameters for "${item?.name || configuringId}".`,
        organizationName: organization.name
      });

      toast.success(`Successfully saved "${item?.name}" configuration!`);
      setConfiguringId(null);
    } catch (error: any) {
      toast.error("Failed to save configuration: " + error.message);
    }
  };

  // WEBHOOK ACTIONS
  const handleAddWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhookUrl.trim()) return;

    try {
      const newWebhook = {
        id: 'wh_' + Math.random().toString(36).substring(2, 9),
        url: newWebhookUrl.trim(),
        secret: newWebhookSecret.trim() || 'whsec_' + Math.random().toString(36).substring(2, 12),
        events: newWebhookEvents,
        status: 'active',
        createdAt: new Date().toISOString()
      };

      const updatedWebhooks = [...webhooks, newWebhook];

      if (!auth?.currentUser) {
        // Guest Mode: Update state locally
        setWebhooks(updatedWebhooks);
        setIntegrationStates(prev => ({
          ...prev,
          webhooks: {
            ...prev.webhooks,
            enabled: true,
            status: 'connected',
            config: { endpoints: updatedWebhooks }
          }
        }));
        toast.success("[Simulated] Webhook endpoint registered successfully!");
        setNewWebhookUrl('');
        setNewWebhookSecret('');
        setNewWebhookEvents(['transcript.created']);
        return;
      }

      const baseUrl = getApiBaseUrl();
      const headers = await getAuthHeaders();
      const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/webhooks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          enabled: true,
          status: 'connected',
          config: { endpoints: updatedWebhooks }
        })
      });

      const parsed = await parseApiResponse(res);
      if (!parsed.ok) {
        throw new Error(parsed.error || "Failed to add webhook");
      }

      setWebhooks(updatedWebhooks);
      setIntegrationStates(prev => ({
        ...prev,
        webhooks: {
          ...prev.webhooks,
          enabled: true,
          status: 'connected',
          config: { endpoints: updatedWebhooks }
        }
      }));

      await logAction(organization.id, {
        action: 'Webhook Added',
        actor: userProfile?.email || 'Admin',
        details: `Registered target webhook endpoint "${newWebhook.url}".`,
        organizationName: organization.name
      });

      toast.success("Webhook endpoint registered successfully!");
      setNewWebhookUrl('');
      setNewWebhookSecret('');
      setNewWebhookEvents(['transcript.created']);
    } catch (error: any) {
      toast.error("Failed to add webhook: " + error.message);
    }
  };

  const handleDeleteWebhook = async (webhookId: string, url: string) => {
    try {
      const updatedWebhooks = webhooks.filter(w => w.id !== webhookId);

      if (!auth?.currentUser) {
        // Guest Mode: Update state locally
        setWebhooks(updatedWebhooks);
        setIntegrationStates(prev => ({
          ...prev,
          webhooks: {
            ...prev.webhooks,
            config: { endpoints: updatedWebhooks }
          }
        }));
        toast.success("[Simulated] Webhook endpoint deleted.");
        return;
      }

      const baseUrl = getApiBaseUrl();
      const headers = await getAuthHeaders();
      const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/webhooks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          enabled: updatedWebhooks.length > 0,
          status: updatedWebhooks.length > 0 ? 'connected' : 'disconnected',
          config: { endpoints: updatedWebhooks }
        })
      });

      const parsed = await parseApiResponse(res);
      if (!parsed.ok) {
        throw new Error(parsed.error || "Deletion failed");
      }

      setWebhooks(updatedWebhooks);
      setIntegrationStates(prev => ({
        ...prev,
        webhooks: {
          ...prev.webhooks,
          config: { endpoints: updatedWebhooks }
        }
      }));

      await logAction(organization.id, {
        action: 'Webhook Deleted',
        actor: userProfile?.email || 'Admin',
        details: `Deleted webhook endpoint "${url}".`,
        organizationName: organization.name
      });

      toast.success("Webhook endpoint deleted.");
    } catch (error: any) {
      toast.error("Deletion failed: " + error.message);
    }
  };

  // REST API KEYS ACTIONS
  const handleGenerateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyLabel.trim()) return;

    try {
      const randomBits = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const rawKey = `en_live_${randomBits}`;
      const maskedKey = `en_live_••••••••••••${rawKey.slice(-4)}`;

      const newKey = {
        id: 'key_' + Math.random().toString(36).substring(2, 9),
        label: newKeyLabel.trim(),
        key: maskedKey,
        createdAt: new Date().toISOString(),
        lastUsedAt: 'Never'
      };

      const updatedKeys = [...apiKeys, newKey];

      if (!auth?.currentUser) {
        // Guest Mode: Update state locally
        setApiKeys(updatedKeys);
        setIntegrationStates(prev => ({
          ...prev,
          'rest-api': {
            ...prev['rest-api'],
            enabled: true,
            status: 'connected',
            config: { keys: updatedKeys }
          }
        }));
        setGeneratedKey(rawKey);
        setNewKeyLabel('');
        setShowKeyModal(true);
        toast.success("[Simulated] API Key generated successfully!");
        return;
      }

      const baseUrl = getApiBaseUrl();
      const headers = await getAuthHeaders();
      const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/rest-api`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          enabled: true,
          status: 'connected',
          config: { keys: updatedKeys }
        })
      });

      const parsed = await parseApiResponse(res);
      if (!parsed.ok) {
        throw new Error(parsed.error || "Failed to generate API key");
      }

      setApiKeys(updatedKeys);
      setIntegrationStates(prev => ({
        ...prev,
        'rest-api': {
          ...prev['rest-api'],
          enabled: true,
          status: 'connected',
          config: { keys: updatedKeys }
        }
      }));

      await logAction(organization.id, {
        action: 'API Key Generated',
        actor: userProfile?.email || 'Admin',
        details: `Generated new platform API Key labelled "${newKey.label}".`,
        organizationName: organization.name
      });

      setGeneratedKey(rawKey);
      setNewKeyLabel('');
      setShowKeyModal(true);
      toast.success("API Key generated successfully!");
    } catch (error: any) {
      toast.error("Failed to generate API key: " + error.message);
    }
  };

  const handleRevokeApiKey = async (keyId: string, label: string) => {
    try {
      const updatedKeys = apiKeys.filter(k => k.id !== keyId);

      if (!auth?.currentUser) {
        // Guest Mode: Update state locally
        setApiKeys(updatedKeys);
        setIntegrationStates(prev => ({
          ...prev,
          'rest-api': {
            ...prev['rest-api'],
            config: { keys: updatedKeys }
          }
        }));
        toast.success("[Simulated] API key revoked successfully.");
        return;
      }

      const baseUrl = getApiBaseUrl();
      const headers = await getAuthHeaders();
      const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/rest-api`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          enabled: updatedKeys.length > 0,
          status: updatedKeys.length > 0 ? 'connected' : 'disconnected',
          config: { keys: updatedKeys }
        })
      });

      const parsed = await parseApiResponse(res);
      if (!parsed.ok) {
        throw new Error(parsed.error || "Revocation failed");
      }

      setApiKeys(updatedKeys);
      setIntegrationStates(prev => ({
        ...prev,
        'rest-api': {
          ...prev['rest-api'],
          config: { keys: updatedKeys }
        }
      }));

      await logAction(organization.id, {
        action: 'API Key Revoked',
        actor: userProfile?.email || 'Admin',
        details: `Revoked REST API Key labelled "${label}".`,
        organizationName: organization.name
      });

      toast.success("API key revoked successfully.");
    } catch (error: any) {
      toast.error("Revocation failed: " + error.message);
    }
  };

  // OAUTH CLIENTS ACTIONS
  const handleCreateOAuthClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim() || !newClientRedirect.trim()) return;

    try {
      const clientId = 'client_' + Math.random().toString(36).substring(2, 12);
      const clientSecret = 'secret_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

      const newClient = {
        id: 'oauth_' + Math.random().toString(36).substring(2, 9),
        name: newClientName.trim(),
        redirectUri: newClientRedirect.trim(),
        clientId,
        clientSecret: `secret_••••••••••••${clientSecret.slice(-4)}`,
        createdAt: new Date().toISOString()
      };

      const updatedClients = [...oauthClients, newClient];

      if (!auth?.currentUser) {
        // Guest Mode: Update state locally
        setOauthClients(updatedClients);
        setIntegrationStates(prev => ({
          ...prev,
          'oauth-clients': {
            ...prev['oauth-clients'],
            enabled: true,
            status: 'connected',
            config: { clients: updatedClients }
          }
        }));
        setGeneratedClient({ id: clientId, secret: clientSecret });
        setNewClientName('');
        setNewClientRedirect('');
        setShowClientModal(true);
        toast.success("[Simulated] OAuth client registration created!");
        return;
      }

      const baseUrl = getApiBaseUrl();
      const headers = await getAuthHeaders();
      const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/oauth-clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          enabled: true,
          status: 'connected',
          config: { clients: updatedClients }
        })
      });

      const parsed = await parseApiResponse(res);
      if (!parsed.ok) {
        throw new Error(parsed.error || "Failed to create OAuth client");
      }

      setOauthClients(updatedClients);
      setIntegrationStates(prev => ({
        ...prev,
        'oauth-clients': {
          ...prev['oauth-clients'],
          enabled: true,
          status: 'connected',
          config: { clients: updatedClients }
        }
      }));

      await logAction(organization.id, {
        action: 'OAuth Client Created',
        actor: userProfile?.email || 'Admin',
        details: `Created custom OAuth Client registration "${newClient.name}".`,
        organizationName: organization.name
      });

      setGeneratedClient({ id: clientId, secret: clientSecret });
      setNewClientName('');
      setNewClientRedirect('');
      setShowClientModal(true);
      toast.success("OAuth client registration created!");
    } catch (error: any) {
      toast.error("Failed to create OAuth client: " + error.message);
    }
  };

  const handleRevokeOAuthClient = async (clientId: string, name: string) => {
    try {
      const updatedClients = oauthClients.filter(c => c.id !== clientId);

      if (!auth?.currentUser) {
        // Guest Mode: Update state locally
        setOauthClients(updatedClients);
        setIntegrationStates(prev => ({
          ...prev,
          'oauth-clients': {
            ...prev['oauth-clients'],
            config: { clients: updatedClients }
          }
        }));
        toast.success("[Simulated] OAuth Client registration revoked.");
        return;
      }

      const baseUrl = getApiBaseUrl();
      const headers = await getAuthHeaders();
      const res = await fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/oauth-clients`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          enabled: updatedClients.length > 0,
          status: updatedClients.length > 0 ? 'connected' : 'disconnected',
          config: { clients: updatedClients }
        })
      });

      const parsed = await parseApiResponse(res);
      if (!parsed.ok) {
        throw new Error(parsed.error || "Failed to revoke OAuth client");
      }

      setOauthClients(updatedClients);
      setIntegrationStates(prev => ({
        ...prev,
        'oauth-clients': {
          ...prev['oauth-clients'],
          config: { clients: updatedClients }
        }
      }));

      await logAction(organization.id, {
        action: 'OAuth Client Revoked',
        actor: userProfile?.email || 'Admin',
        details: `Revoked custom OAuth Client registration "${name}".`,
        organizationName: organization.name
      });

      toast.success("OAuth Client registration revoked.");
    } catch (error: any) {
      toast.error("Failed to revoke OAuth client: " + error.message);
    }
  };

  const copyToClipboard = (text: string, message: string) => {
    navigator.clipboard.writeText(text);
    toast.success(message);
  };

  const filteredIntegrations = availableIntegrations.filter(item => {
    if (activeSubTab === 'all') return true;
    return item.category === activeSubTab;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <RefreshCw className="animate-spin text-indigo-600" size={32} />
        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Syncing Enterprise Integrations Ledger...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white border border-slate-100 p-6 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <Globe size={16} className="text-indigo-600" /> Enterprise Integration Portals
          </h2>
          <p className="text-[11px] text-slate-500 font-medium">Configure deep linkages, custom endpoints, webhook routing, and REST services securely.</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
          <Shield size={12} className="text-emerald-600" /> Secure Corporate Syncing Mode
        </div>
      </div>

      {/* Grid Subtab Selectors */}
      <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl self-start">
        {[
          { id: 'all', label: 'All Portals' },
          { id: 'productivity', label: 'Productivity' },
          { id: 'collaboration', label: 'Chat & Teams' },
          { id: 'video', label: 'Voice & Video' },
          { id: 'developer', label: 'Developer & Webhooks' }
        ].map(sub => (
          <button
            key={sub.id}
            onClick={() => setActiveSubTab(sub.id as any)}
            className={`px-3.5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
              activeSubTab === sub.id
                ? 'bg-white text-slate-900 shadow-sm font-black'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {/* Active Bento Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredIntegrations.map(item => {
          const state = integrationStates[item.id] || { enabled: false, status: 'disconnected', config: {} };
          const isEnabled = state.enabled;

          return (
            <motion.div
              key={item.id}
              layout
              className={`border border-slate-200/80 hover:border-slate-300 rounded-2xl p-5 flex flex-col justify-between bg-white shadow-sm hover:shadow-md transition-all duration-300 border-l-4 ${item.brandColor}`}
            >
              <div className="space-y-4">
                {/* Card Header */}
                <div className="flex justify-between items-start">
                  <div className="p-2.5 bg-white border border-slate-100 rounded-xl shadow-inner">
                    {item.icon}
                  </div>

                  {/* Toggle Switch */}
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      isEnabled 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>
                      {isEnabled ? 'Active' : 'Disabled'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleIntegration(item.id, isEnabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isEnabled ? 'bg-indigo-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Info Text */}
                <div className="space-y-1">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{item.name}</h3>
                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed min-h-[44px]">
                    {item.description}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => handleOpenConfig(item.id)}
                  className="flex-1 py-1.5 px-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-center gap-1 transition-all"
                >
                  <Settings size={12} className="text-slate-500" />
                  Configure
                </button>
                <a
                  href={item.docsUrl}
                  target="_blank"
                  referrerPolicy="no-referrer"
                  className="py-1.5 px-3 hover:bg-slate-50 border border-transparent hover:border-slate-200 rounded-lg text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center transition-all"
                >
                  Docs
                </a>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Inline Configuration Portal Drawer Overlay */}
      <AnimatePresence>
        {configuringId && (() => {
          const item = availableIntegrations.find(i => i.id === configuringId);
          if (!item) return null;

          return (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="border border-indigo-100 rounded-2xl bg-indigo-50/10 p-6 space-y-6"
            >
              <div className="flex justify-between items-center border-b border-indigo-100/50 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded-xl border border-indigo-100">
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Configure {item.name}</h3>
                    <p className="text-[10px] text-slate-500">Provide keys and secrets securely. Values are encrypted at rest in Firestore.</p>
                  </div>
                </div>
                <button
                  onClick={() => setConfiguringId(null)}
                  className="p-1 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <form onSubmit={handleSaveConfig} className="space-y-4 max-w-2xl">
                {/* Google Workspace fields */}
                {configuringId === 'google-workspace' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">G-Suite Domain</label>
                      <input
                        type="text"
                        placeholder="e.g. acme-corp.com"
                        value={formData.googleDomain || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, googleDomain: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Service Account Key (JSON Payload)</label>
                      <textarea
                        rows={3}
                        placeholder="{ 'type': 'service_account', ... }"
                        value={formData.googleServiceAccount || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, googleServiceAccount: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-mono bg-white focus:outline-none focus:border-indigo-600"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="googleSync"
                        checked={formData.googleSync || false}
                        onChange={(e) => setFormData(prev => ({ ...prev, googleSync: e.target.checked }))}
                        className="rounded text-indigo-600"
                      />
                      <label htmlFor="googleSync" className="text-[10px] font-semibold text-slate-600">Auto-sync daily meetings with Google Calendar resources</label>
                    </div>
                  </div>
                )}

                {/* Microsoft 365 fields */}
                {configuringId === 'microsoft-365' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Tenant ID</label>
                        <input
                          type="text"
                          placeholder="e.g. 1a2b3c4d-5e6f-7g8h-9i0j-k1l2m3n4o5p6"
                          value={formData.m365TenantId || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, m365TenantId: e.target.value }))}
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Client Application ID</label>
                        <input
                          type="text"
                          placeholder="e.g. 9i0j-k1l2m3n4o5p6-1a2b3c4d-5e6f-7g8h"
                          value={formData.m365ClientId || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, m365ClientId: e.target.value }))}
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Application Client Secret</label>
                      <div className="relative">
                        <input
                          type={showSecrets['m365Secret'] ? 'text' : 'password'}
                          placeholder="••••••••••••••••••••••••••••••••"
                          value={formData.m365ClientSecret || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, m365ClientSecret: e.target.value }))}
                          className="w-full pl-3 pr-10 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => toggleSecret('m365Secret')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showSecrets['m365Secret'] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Slack fields */}
                {configuringId === 'slack' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Slack Bot OAuth Token (xoxb-)</label>
                      <div className="relative">
                        <input
                          type={showSecrets['slackBotToken'] ? 'text' : 'password'}
                          placeholder="xoxb-1234567890-abcdef..."
                          value={formData.slackBotToken || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, slackBotToken: e.target.value }))}
                          className="w-full pl-3 pr-10 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => toggleSecret('slackBotToken')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showSecrets['slackBotToken'] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Default Workspace Broadcast Channel</label>
                      <input
                        type="text"
                        placeholder="e.g. #transcripts-feed"
                        value={formData.slackDefaultChannel || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, slackDefaultChannel: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                        required
                      />
                    </div>
                  </div>
                )}

                {/* Zoom fields */}
                {configuringId === 'zoom' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Zoom Account ID</label>
                        <input
                          type="text"
                          placeholder="AcmeCorpZoom"
                          value={formData.zoomAccountId || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, zoomAccountId: e.target.value }))}
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Zoom Client ID</label>
                        <input
                          type="text"
                          placeholder="zoom_client_id"
                          value={formData.zoomClientId || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, zoomClientId: e.target.value }))}
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Zoom Client Secret</label>
                      <div className="relative">
                        <input
                          type={showSecrets['zoomSecret'] ? 'text' : 'password'}
                          placeholder="••••••••••••••••••••••••"
                          value={formData.zoomClientSecret || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, zoomClientSecret: e.target.value }))}
                          className="w-full pl-3 pr-10 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => toggleSecret('zoomSecret')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showSecrets['zoomSecret'] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Google Meet fields */}
                {configuringId === 'google-meet' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Google API Client ID (Meet integration)</label>
                      <input
                        type="text"
                        placeholder="apps.googleusercontent.com Client ID"
                        value={formData.meetClientId || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, meetClientId: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                        required
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="meetAutoRecord"
                        checked={formData.meetAutoRecord || false}
                        onChange={(e) => setFormData(prev => ({ ...prev, meetAutoRecord: e.target.checked }))}
                        className="rounded text-indigo-600"
                      />
                      <label htmlFor="meetAutoRecord" className="text-[10px] font-semibold text-slate-600">Auto-inject EchoNote bot when calendar matches meet.google.com link</label>
                    </div>
                  </div>
                )}

                {/* Microsoft Teams fields */}
                {configuringId === 'microsoft-teams' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Teams Channel Webhook URL</label>
                      <input
                        type="url"
                        placeholder="https://outlook.office.com/webhook/..."
                        value={formData.teamsWebhookUrl || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, teamsWebhookUrl: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                        required
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="teamsBroadcaster"
                        checked={formData.teamsBroadcaster || false}
                        onChange={(e) => setFormData(prev => ({ ...prev, teamsBroadcaster: e.target.checked }))}
                        className="rounded text-indigo-600"
                      />
                      <label htmlFor="teamsBroadcaster" className="text-[10px] font-semibold text-slate-600">Broadcast key decision items and transcripts directly on Teams Channels</label>
                    </div>
                  </div>
                )}

                {/* Zapier fields */}
                {configuringId === 'zapier' && (
                  <div className="space-y-3">
                    <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl space-y-2">
                      <p className="text-[10px] text-orange-800 font-bold uppercase tracking-wider flex items-center gap-1">
                        <Zap size={12} /> Custom Zapier Setup Instructions
                      </p>
                      <p className="text-[10px] text-orange-600 font-medium leading-relaxed">
                        To connect your Workspace to Zapier, create a trigger selecting the EchoNote app and provide your REST API key listed in the developer subtab.
                      </p>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Active Integration Shared Secret</label>
                      <input
                        type="text"
                        placeholder="Auto-generated Zapier secret"
                        value={formData.zapierSecret || 'zapsec_acme_' + Math.random().toString(36).substring(2, 10)}
                        readOnly
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-slate-50 font-mono text-slate-500"
                      />
                    </div>
                  </div>
                )}

                {/* Webhooks configuration redirect */}
                {configuringId === 'webhooks' && (
                  <div className="p-4 bg-rose-50/30 border border-rose-100 rounded-xl">
                    <p className="text-[10px] text-rose-800 font-black uppercase tracking-wider mb-1">Webhooks Configuration Ledger</p>
                    <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                      Create, monitor, and revoke real-time webhook routing subscriptions in the dedicated console segment directly below.
                    </p>
                  </div>
                )}

                {/* REST API and OAuth clients redirection */}
                {(configuringId === 'rest-api' || configuringId === 'oauth-clients') && (
                  <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-xl">
                    <p className="text-[10px] text-indigo-800 font-black uppercase tracking-wider mb-1">Developer Credentials Workspace</p>
                    <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                      API Keys and Client IDs are fully manageable using their corresponding custom interfaces below. Ensure you guard generated credentials carefully.
                    </p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all shadow-sm"
                  >
                    Save Configuration
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfiguringId(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* WEBHOOKS CONSOLE (Prepare architecture, connection status, add/delete webhooks) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-4 border-t border-slate-100">
        <div className="lg:col-span-4 space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
              <Webhook size={14} className="text-rose-500" /> Webhook Routing Registry
            </h3>
            <p className="text-[10px] text-slate-500 leading-relaxed font-medium">Configure endpoints to route automated JSON payloads when strategic transcriptions and decisions finish processing.</p>
          </div>

          <form onSubmit={handleAddWebhook} className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-sm space-y-4">
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Target Endpoint URL</label>
              <input
                type="url"
                placeholder="https://api.yourdomain.com/webhooks"
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-slate-50 focus:outline-none focus:border-indigo-600"
                required
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Signing Secret (Optional)</label>
              <input
                type="text"
                placeholder="Leave blank to auto-generate"
                value={newWebhookSecret}
                onChange={(e) => setNewWebhookSecret(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-mono bg-slate-50 focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Event Subscriptions</label>
              <div className="space-y-1.5 pt-1.5">
                {[
                  { id: 'transcript.created', label: 'Transcript Created' },
                  { id: 'decision.generated', label: 'Decision intelligence Generated' },
                  { id: 'member.joined', label: 'New Member Joined Workspace' }
                ].map(ev => {
                  const isChecked = newWebhookEvents.includes(ev.id);
                  return (
                    <div key={ev.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`ev-${ev.id}`}
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            setNewWebhookEvents(prev => prev.filter(p => p !== ev.id));
                          } else {
                            setNewWebhookEvents(prev => [...prev, ev.id]);
                          }
                        }}
                        className="rounded text-indigo-600"
                      />
                      <label htmlFor={`ev-${ev.id}`} className="text-[10px] font-semibold text-slate-600">{ev.label}</label>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm"
            >
              <Plus size={12} /> Register Endpoint
            </button>
          </form>
        </div>

        {/* Webhooks table */}
        <div className="lg:col-span-8 space-y-4">
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Registered Webhook Routings ({webhooks.length})</h4>
          
          <div className="border border-slate-100 rounded-2xl bg-white shadow-sm overflow-hidden">
            {webhooks.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-[11px] font-medium">
                No active webhooks configured. Register your first endpoint to receive instant real-time payloads.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50 text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      <th className="p-3">Target Endpoint</th>
                      <th className="p-3">Subscribed Events</th>
                      <th className="p-3">Signing Secret</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px] font-semibold text-slate-700">
                    {webhooks.map((wh) => (
                      <tr key={wh.id} className="hover:bg-slate-50/50">
                        <td className="p-3 max-w-xs truncate" title={wh.url}>
                          <span className="font-bold text-slate-900">{wh.url}</span>
                          <span className="block text-[8px] text-slate-400 font-mono mt-0.5">ID: {wh.id} • Created {new Date(wh.createdAt).toLocaleDateString()}</span>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {wh.events.map((ev: string) => (
                              <span key={ev} className="px-1.5 py-0.5 bg-rose-50 text-rose-700 text-[8px] font-black uppercase tracking-wider rounded border border-rose-100/50">
                                {ev}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 font-mono text-[10px] text-slate-500">
                          {wh.secret}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteWebhook(wh.id, wh.url)}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-100 transition-colors"
                            title="Delete webhook routing"
                          >
                            <Trash2 size={13} />
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
      </div>

      {/* REST API KEYS CONSOLE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8 border-t border-slate-100">
        <div className="lg:col-span-4 space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
              <Key size={14} className="text-indigo-600" /> Platform REST API Keys
            </h3>
            <p className="text-[10px] text-slate-500 leading-relaxed font-medium">Generate long-lived bearer tokens to connect custom workflows and backend processes to the EchoNote transcription core.</p>
          </div>

          <form onSubmit={handleGenerateApiKey} className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-sm space-y-3">
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Key Label / Name</label>
              <input
                type="text"
                placeholder="e.g. Production Backend Link, CI Sync"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-slate-50 focus:outline-none focus:border-indigo-600"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm"
            >
              <Plus size={12} /> Generate Key Token
            </button>
          </form>
        </div>

        {/* API keys table */}
        <div className="lg:col-span-8 space-y-4">
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Active Workspace API Keys ({apiKeys.length})</h4>

          <div className="border border-slate-100 rounded-2xl bg-white shadow-sm overflow-hidden">
            {apiKeys.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-[11px] font-medium">
                No active REST API Keys generated. Create a bearer key to start polling files and intelligence assets programmatically.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50 text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      <th className="p-3">Bearer Key Label</th>
                      <th className="p-3">Token Pattern</th>
                      <th className="p-3">Generated At</th>
                      <th className="p-3 text-right">Revocation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px] font-semibold text-slate-700">
                    {apiKeys.map((k) => (
                      <tr key={k.id} className="hover:bg-slate-50/50">
                        <td className="p-3">
                          <span className="font-bold text-slate-900">{k.label}</span>
                          <span className="block text-[8px] text-slate-400 font-mono mt-0.5">Key ID: {k.id}</span>
                        </td>
                        <td className="p-3 font-mono text-[10px] text-indigo-600 select-all">
                          {k.key}
                        </td>
                        <td className="p-3 text-slate-400 font-mono text-[10px]">
                          {new Date(k.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleRevokeApiKey(k.id, k.label)}
                            className="px-2 py-1 bg-rose-50 text-rose-700 text-[9px] font-bold uppercase tracking-wider rounded border border-rose-100 hover:bg-rose-100 transition-colors"
                          >
                            Revoke Key
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
      </div>

      {/* OAUTH CUSTOM CLIENTS REGISTER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8 border-t border-slate-100">
        <div className="lg:col-span-4 space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
              <Users size={14} className="text-amber-600" /> OAuth 2.0 Custom Clients
            </h3>
            <p className="text-[10px] text-slate-500 leading-relaxed font-medium">Register secure client authorizations so your proprietary enterprise dashboards and apps can request delegated access to EchoNote resources.</p>
          </div>

          <form onSubmit={handleCreateOAuthClient} className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-sm space-y-3">
            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Application Name</label>
              <input
                type="text"
                placeholder="e.g. Internal CRM Connector"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-slate-50 focus:outline-none focus:border-indigo-600"
                required
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Authorized Redirect URI</label>
              <input
                type="url"
                placeholder="https://crm.yourdomain.com/oauth/callback"
                value={newClientRedirect}
                onChange={(e) => setNewClientRedirect(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-slate-50 focus:outline-none focus:border-indigo-600"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm"
            >
              <Plus size={12} /> Register OAuth Client
            </button>
          </form>
        </div>

        {/* OAuth clients table */}
        <div className="lg:col-span-8 space-y-4">
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Registered OAuth Client Profiles ({oauthClients.length})</h4>

          <div className="border border-slate-100 rounded-2xl bg-white shadow-sm overflow-hidden">
            {oauthClients.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-[11px] font-medium">
                No custom OAuth client registrations detected. Register client containers to allow single-sign-on or delegated platform API grants.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50 text-[9px] font-black uppercase text-slate-400 tracking-wider">
                      <th className="p-3">Client Profile</th>
                      <th className="p-3">Client Credentials</th>
                      <th className="p-3">Authorized Redirect URI</th>
                      <th className="p-3 text-right">Registry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px] font-semibold text-slate-700">
                    {oauthClients.map((client) => (
                      <tr key={client.id} className="hover:bg-slate-50/50">
                        <td className="p-3">
                          <span className="font-bold text-slate-900">{client.name}</span>
                          <span className="block text-[8px] text-slate-400 font-mono mt-0.5">ID: {client.id} • Registered {new Date(client.createdAt).toLocaleDateString()}</span>
                        </td>
                        <td className="p-3 space-y-0.5">
                          <div className="text-[9px] font-semibold text-slate-500">ID: <code className="font-mono text-slate-900 select-all">{client.clientId}</code></div>
                          <div className="text-[9px] font-semibold text-slate-500">Secret: <code className="font-mono text-slate-400">{client.clientSecret}</code></div>
                        </td>
                        <td className="p-3 font-mono text-[10px] text-indigo-600 max-w-xs truncate" title={client.redirectUri}>
                          {client.redirectUri}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleRevokeOAuthClient(client.id, client.name)}
                            className="px-2 py-1 bg-rose-50 text-rose-700 text-[9px] font-bold uppercase tracking-wider rounded border border-rose-100 hover:bg-rose-100 transition-colors"
                          >
                            Revoke Client
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
      </div>

      {/* API KEY DISPLAY MODAL */}
      {showKeyModal && generatedKey && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 border border-slate-100 shadow-2xl animate-in zoom-in-95">
            <div className="space-y-1">
              <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                <Shield size={14} className="text-indigo-600 animate-pulse" /> Secure API Token Generated
              </h3>
              <p className="text-[10px] text-slate-400">Copy this REST token immediately. For your workspace safety, it will not be displayed again.</p>
            </div>

            <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 flex justify-between items-center">
              <span className="font-mono text-indigo-700 text-[10px] select-all break-all pr-2">{generatedKey}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(generatedKey, "API key token copied!")}
                className="p-1.5 bg-white text-slate-500 border border-slate-200 rounded-lg hover:text-slate-900 shadow-sm shrink-0"
                title="Copy API Token"
              >
                <Copy size={12} />
              </button>
            </div>

            <button
              onClick={() => {
                setShowKeyModal(false);
                setGeneratedKey(null);
              }}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all"
            >
              I Have Stored the Token Safely
            </button>
          </div>
        </div>
      )}

      {/* OAUTH CREDENTIALS DISPLAY MODAL */}
      {showClientModal && generatedClient && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 border border-slate-100 shadow-2xl animate-in zoom-in-95">
            <div className="space-y-1">
              <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                <Users size={14} className="text-amber-600 animate-pulse" /> Custom OAuth Credentials
              </h3>
              <p className="text-[10px] text-slate-400">Save these secure client secrets directly in your configuration portal. This secret cannot be queried later.</p>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-0.5">OAuth Client ID</label>
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 flex justify-between items-center">
                  <span className="font-mono text-slate-800 text-[10px] select-all break-all">{generatedClient.id}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedClient.id, "Client ID copied!")}
                    className="p-1 hover:bg-white text-slate-400 border border-transparent hover:border-slate-200 rounded transition-all"
                  >
                    <Copy size={10} />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-0.5">OAuth Client Secret</label>
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 flex justify-between items-center">
                  <span className="font-mono text-slate-800 text-[10px] select-all break-all">{generatedClient.secret}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedClient.secret, "Client Secret copied!")}
                    className="p-1 hover:bg-white text-slate-400 border border-transparent hover:border-slate-200 rounded transition-all"
                  >
                    <Copy size={10} />
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setShowClientModal(false);
                setGeneratedClient(null);
              }}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all"
            >
              Credentials Stored Safely
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
