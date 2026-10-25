import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderPlus,
  Layers,
  Calendar,
  Users,
  CheckCircle2,
  AlertCircle,
  Copy,
  Trash2,
  ChevronRight,
  ArrowRight,
  Sparkles,
  X,
  Plus,
  Clock,
  ListTodo,
  Tag
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ProjectTemplate,
  ProjectTemplateTask,
  UserProfile,
  Project
} from '../types';
import {
  getTemplates,
  getTemplateDetail,
  createTemplate,
  duplicateTemplate,
  deleteTemplate,
  createProjectFromTemplate
} from '../lib/apiClient';

interface ProjectTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile;
  organizationId?: string | null;
  onProjectCreated: (createdProject: { id: string; name: string }) => void;
}

export const ProjectTemplateModal: React.FC<ProjectTemplateModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  organizationId,
  onProjectCreated
}) => {
  const [activeTab, setActiveTab] = useState<'browse' | 'create_template'>('browse');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'starter' | 'custom'>('all');
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);

  // Instantiation Form State
  const [projectName, setProjectName] = useState<string>('');
  const [projectDescription, setProjectDescription] = useState<string>('');
  const [anchorDate, setAnchorDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [roleMappings, setRoleMappings] = useState<Record<string, { email: string; name: string }>>({});
  const [isInstantiating, setIsInstantiating] = useState<boolean>(false);

  // Custom Template Creation State
  const [newTemplateName, setNewTemplateName] = useState<string>('');
  const [newTemplateDescription, setNewTemplateDescription] = useState<string>('');
  const [newTemplateCategory, setNewTemplateCategory] = useState<string>('custom');
  const [newTemplateTasks, setNewTemplateTasks] = useState<Array<{
    id: string;
    title: string;
    description: string;
    phase: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    rolePlaceholder: string;
    startOffsetDays: number;
    dueOffsetDays: number;
    prerequisiteTemplateItemIds: string[];
  }>>([
    {
      id: 'task_1',
      title: 'Initial Discovery & Planning',
      description: 'Define scope, key goals, and milestones.',
      phase: 'Planning',
      priority: 'high',
      rolePlaceholder: 'Project Lead',
      startOffsetDays: 0,
      dueOffsetDays: 2,
      prerequisiteTemplateItemIds: []
    }
  ]);
  const [isSavingTemplate, setIsSavingTemplate] = useState<boolean>(false);

  // Load templates
  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTemplates({
        scope: scopeFilter === 'all' ? undefined : (scopeFilter as any),
        organizationId: organizationId || undefined
      });
      if (res.ok && res.data) {
        setTemplates(res.data.templates || []);
      } else {
        toast.error(res.error || 'Failed to load templates');
      }
    } catch (err: any) {
      console.error('Failed to load templates:', err);
      toast.error('Network error loading templates');
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, organizationId]);

  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen, loadTemplates]);

  // Select a template for preview & instantiation
  const handleSelectTemplate = (tpl: ProjectTemplate) => {
    setSelectedTemplate(tpl);
    setProjectName(tpl.name);
    setProjectDescription(tpl.description || '');
    // Initialize role placeholders mapping
    const initialMappings: Record<string, { email: string; name: string }> = {};
    const roles = tpl.rolePlaceholders || [];
    roles.forEach(role => {
      initialMappings[role] = {
        email: userProfile?.email || '',
        name: userProfile?.displayName || userProfile?.name || 'Project Lead'
      };
    });
    setRoleMappings(initialMappings);
  };

  // Instantiation Action
  const handleCreateProject = async () => {
    if (!selectedTemplate) return;
    if (!projectName.trim()) {
      toast.error('Please enter a project name.');
      return;
    }

    setIsInstantiating(true);
    try {
      const res = await createProjectFromTemplate(selectedTemplate.id, {
        projectName: projectName.trim(),
        projectDescription: projectDescription.trim() || undefined,
        anchorDate,
        organizationId: organizationId || null,
        roleMappings
      });

      if (res.ok && res.data) {
        toast.success(res.data.message || 'Project created successfully!');
        onProjectCreated({
          id: res.data.project.id,
          name: res.data.project.name
        });
        onClose();
      } else {
        toast.error(res.error || 'Failed to create project from template.');
      }
    } catch (err: any) {
      console.error('Error creating project from template:', err);
      toast.error('Network error creating project.');
    } finally {
      setIsInstantiating(false);
    }
  };

  // Duplicate a template
  const handleDuplicate = async (e: React.MouseEvent, tpl: ProjectTemplate) => {
    e.stopPropagation();
    try {
      const res = await duplicateTemplate(tpl.id, `${tpl.name} (Copy)`);
      if (res.ok && res.data) {
        toast.success(`Duplicated "${tpl.name}"`);
        loadTemplates();
      } else {
        toast.error(res.error || 'Failed to duplicate template');
      }
    } catch {
      toast.error('Error duplicating template');
    }
  };

  // Delete custom template
  const handleDelete = async (e: React.MouseEvent, tpl: ProjectTemplate) => {
    e.stopPropagation();
    if (tpl.isStarter) return;
    if (!window.confirm(`Are you sure you want to delete template "${tpl.name}"?`)) return;

    try {
      const res = await deleteTemplate(tpl.id);
      if (res.ok) {
        toast.success('Template deleted');
        if (selectedTemplate?.id === tpl.id) {
          setSelectedTemplate(null);
        }
        loadTemplates();
      } else {
        toast.error(res.error || 'Failed to delete template');
      }
    } catch {
      toast.error('Error deleting template');
    }
  };

  // Add a task in custom template creator
  const handleAddTaskToDraft = () => {
    const nextIdx = newTemplateTasks.length + 1;
    setNewTemplateTasks([
      ...newTemplateTasks,
      {
        id: `task_${nextIdx}`,
        title: '',
        description: '',
        phase: 'Execution',
        priority: 'medium',
        rolePlaceholder: 'Team Member',
        startOffsetDays: nextIdx,
        dueOffsetDays: nextIdx + 2,
        prerequisiteTemplateItemIds: nextIdx > 1 ? [`task_${nextIdx - 1}`] : []
      }
    ]);
  };

  // Save new custom template
  const handleSaveCustomTemplate = async () => {
    if (!newTemplateName.trim()) {
      toast.error('Template name is required.');
      return;
    }

    // Check task titles
    for (let i = 0; i < newTemplateTasks.length; i++) {
      if (!newTemplateTasks[i].title.trim()) {
        toast.error(`Task ${i + 1} requires a title.`);
        return;
      }
    }

    setIsSavingTemplate(true);
    try {
      const res = await createTemplate({
        name: newTemplateName.trim(),
        description: newTemplateDescription.trim(),
        category: newTemplateCategory,
        scope: organizationId ? 'organization' : 'project',
        organizationId: organizationId || null,
        tasks: newTemplateTasks
      });

      if (res.ok && res.data) {
        toast.success('Custom template created successfully!');
        setActiveTab('browse');
        setNewTemplateName('');
        setNewTemplateDescription('');
        loadTemplates();
      } else {
        toast.error(res.error || 'Failed to save template');
      }
    } catch {
      toast.error('Error creating template');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl border border-indigo-100/50">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">Project Templates & Workflows</h2>
              <p className="text-xs text-slate-500">Create structured projects with tasks, milestones, and dependencies in one click.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveTab('browse');
                setSelectedTemplate(null);
              }}
              className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all border-b-2 flex items-center gap-2 ${
                activeTab === 'browse'
                  ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Browse Templates</span>
            </button>
            <button
              onClick={() => setActiveTab('create_template')}
              className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all border-b-2 flex items-center gap-2 ${
                activeTab === 'create_template'
                  ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>Create Custom Template</span>
            </button>
          </div>

          {activeTab === 'browse' && (
            <div className="flex items-center gap-1.5 pb-2">
              <button
                onClick={() => setScopeFilter('all')}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                  scopeFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setScopeFilter('starter')}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                  scopeFilter === 'starter' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Starters
              </button>
              <button
                onClick={() => setScopeFilter('custom')}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                  scopeFilter === 'custom' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Custom
              </button>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'browse' ? (
            selectedTemplate ? (
              /* Selected Template Instantiation Screen */
              <div className="space-y-6 animate-in fade-in duration-200">
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1.5 mb-2"
                >
                  <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                  <span>Back to template gallery</span>
                </button>

                <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-200/60 text-indigo-800">
                        {selectedTemplate.category || 'Template'}
                      </span>
                      {selectedTemplate.isStarter && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800">
                          Built-in Starter
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-black text-slate-900">{selectedTemplate.name}</h3>
                    <p className="text-xs text-slate-600 mt-1 max-w-2xl">{selectedTemplate.description}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-bold text-slate-600">
                    <div className="text-center px-3 py-1.5 bg-white rounded-xl border border-slate-200 shadow-2xs">
                      <p className="text-[10px] text-slate-400 uppercase">Tasks</p>
                      <p className="text-sm font-black text-slate-900">{selectedTemplate.tasks?.length || 0}</p>
                    </div>
                    <div className="text-center px-3 py-1.5 bg-white rounded-xl border border-slate-200 shadow-2xs">
                      <p className="text-[10px] text-slate-400 uppercase">Phases</p>
                      <p className="text-sm font-black text-slate-900">{selectedTemplate.phases?.length || 1}</p>
                    </div>
                  </div>
                </div>

                {/* Configuration Inputs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      New Project Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="e.g. Q4 Product Launch"
                      className="w-full px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Project Anchor Date (Start Date)
                    </label>
                    <input
                      type="date"
                      value={anchorDate}
                      onChange={(e) => setAnchorDate(e.target.value)}
                      className="w-full px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Project Description
                    </label>
                    <textarea
                      rows={2}
                      value={projectDescription}
                      onChange={(e) => setProjectDescription(e.target.value)}
                      placeholder="Context, objectives, or goals for this project..."
                      className="w-full px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                    />
                  </div>
                </div>

                {/* Role Mapping Section */}
                {selectedTemplate.rolePlaceholders && selectedTemplate.rolePlaceholders.length > 0 && (
                  <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-3">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-600" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Assignee Role Placeholders
                      </h4>
                    </div>
                    <p className="text-xs text-slate-500">
                      Map template roles to members. Unmapped roles will remain unassigned.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      {selectedTemplate.rolePlaceholders.map(role => (
                        <div key={role} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200">
                          <span className="text-xs font-bold text-slate-800">{role}</span>
                          <input
                            type="email"
                            placeholder="Assignee email..."
                            value={roleMappings[role]?.email || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRoleMappings(prev => ({
                                ...prev,
                                [role]: { email: val, name: val.split('@')[0] || '' }
                              }));
                            }}
                            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-600 w-48 font-medium"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Planned Tasks Outline */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                    <ListTodo className="w-4 h-4 text-indigo-600" />
                    <span>Tasks & Milestones Preview ({selectedTemplate.tasks?.length || 0})</span>
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {selectedTemplate.tasks?.map((t: ProjectTemplateTask, idx: number) => (
                      <div key={t.id || idx} className="p-3 bg-white rounded-xl border border-slate-200 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-900">{t.title}</span>
                            {t.phase && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                                {t.phase}
                              </span>
                            )}
                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-black uppercase ${
                              t.priority === 'urgent' ? 'bg-rose-100 text-rose-700' :
                              t.priority === 'high' ? 'bg-amber-100 text-amber-800' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {t.priority || 'medium'}
                            </span>
                          </div>
                          {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                          {t.prerequisiteTemplateItemIds && t.prerequisiteTemplateItemIds.length > 0 && (
                            <p className="text-[11px] text-indigo-600 font-medium">
                              Prerequisites: {t.prerequisiteTemplateItemIds.join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0 text-xs font-bold text-slate-400">
                          {typeof t.startOffsetDays === 'number' && typeof t.dueOffsetDays === 'number' ? (
                            <span>Day +{t.startOffsetDays} → +{t.dueOffsetDays}</span>
                          ) : (
                            <span>No dates</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => setSelectedTemplate(null)}
                    className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateProject}
                    disabled={isInstantiating || !projectName.trim()}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-2"
                  >
                    {isInstantiating ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Creating Project...</span>
                      </>
                    ) : (
                      <>
                        <FolderPlus className="w-4 h-4" />
                        <span>Create Project from Template</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* Templates Gallery View */
              <div className="space-y-4">
                {loading ? (
                  <div className="py-16 text-center space-y-3">
                    <div className="w-8 h-8 border-3 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-slate-500 font-medium">Loading project templates...</p>
                  </div>
                ) : templates.length === 0 ? (
                  <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-3xl space-y-3">
                    <Layers className="w-10 h-10 text-slate-300 mx-auto" />
                    <h3 className="text-sm font-bold text-slate-700">No Templates Found</h3>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      There are no templates in this category. You can create a custom template or switch scopes.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {templates.map(tpl => (
                      <div
                        key={tpl.id}
                        onClick={() => handleSelectTemplate(tpl)}
                        className="p-5 bg-white border border-slate-200 hover:border-indigo-400 rounded-2xl shadow-2xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group space-y-4"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-50 text-indigo-700 border border-indigo-100">
                                {tpl.category || 'Workflow'}
                              </span>
                              {tpl.isStarter && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-1">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>Starter</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                title="Duplicate Template"
                                onClick={(e) => handleDuplicate(e, tpl)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              {!tpl.isStarter && tpl.createdBy === userProfile?.id && (
                                <button
                                  title="Delete Template"
                                  onClick={(e) => handleDelete(e, tpl)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          <h3 className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors">
                            {tpl.name}
                          </h3>
                          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                            {tpl.description}
                          </p>
                        </div>

                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-3 text-slate-500 font-semibold">
                            <span>{tpl.tasks?.length || 0} Tasks</span>
                            <span>•</span>
                            <span>{tpl.phases?.length || 1} Phases</span>
                          </div>
                          <span className="text-indigo-600 font-bold flex items-center gap-1 text-[11px] group-hover:translate-x-0.5 transition-transform">
                            <span>Use Template</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            /* Create Custom Template Screen */
            <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in duration-200">
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-900">Define Custom Template</h3>
                <p className="text-xs text-slate-500">
                  Build a reusable blueprint for your team with ordered phases, tasks, and dependency chains.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">Template Name *</label>
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="e.g. Client Onboarding Sprint"
                    className="w-full px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">Description</label>
                  <textarea
                    rows={2}
                    value={newTemplateDescription}
                    onChange={(e) => setNewTemplateDescription(e.target.value)}
                    placeholder="What is this workflow used for?"
                    className="w-full px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
                  />
                </div>

                {/* Draft Tasks */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Task Definitions</h4>
                    <button
                      onClick={handleAddTaskToDraft}
                      className="px-3 py-1.5 text-xs font-bold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Task</span>
                    </button>
                  </div>

                  <div className="space-y-3">
                    {newTemplateTasks.map((t, index) => (
                      <div key={t.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-400">Task #{index + 1} ({t.id})</span>
                          {newTemplateTasks.length > 1 && (
                            <button
                              onClick={() => setNewTemplateTasks(newTemplateTasks.filter((_, i) => i !== index))}
                              className="text-xs text-rose-500 hover:text-rose-700 font-bold"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="md:col-span-2">
                            <input
                              type="text"
                              value={t.title}
                              onChange={(e) => {
                                const updated = [...newTemplateTasks];
                                updated[index].title = e.target.value;
                                setNewTemplateTasks(updated);
                              }}
                              placeholder="Task title..."
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-medium"
                            />
                          </div>
                          <div>
                            <select
                              value={t.priority}
                              onChange={(e) => {
                                const updated = [...newTemplateTasks];
                                updated[index].priority = e.target.value as any;
                                setNewTemplateTasks(updated);
                              }}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-medium"
                            >
                              <option value="low">Low Priority</option>
                              <option value="medium">Medium Priority</option>
                              <option value="high">High Priority</option>
                              <option value="urgent">Urgent</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Phase</label>
                            <input
                              type="text"
                              value={t.phase}
                              onChange={(e) => {
                                const updated = [...newTemplateTasks];
                                updated[index].phase = e.target.value;
                                setNewTemplateTasks(updated);
                              }}
                              placeholder="e.g. Planning"
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Role</label>
                            <input
                              type="text"
                              value={t.rolePlaceholder}
                              onChange={(e) => {
                                const updated = [...newTemplateTasks];
                                updated[index].rolePlaceholder = e.target.value;
                                setNewTemplateTasks(updated);
                              }}
                              placeholder="e.g. Lead"
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Start Offset (Days)</label>
                            <input
                              type="number"
                              min={0}
                              value={t.startOffsetDays}
                              onChange={(e) => {
                                const updated = [...newTemplateTasks];
                                updated[index].startOffsetDays = parseInt(e.target.value, 10) || 0;
                                setNewTemplateTasks(updated);
                              }}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Due Offset (Days)</label>
                            <input
                              type="number"
                              min={0}
                              value={t.dueOffsetDays}
                              onChange={(e) => {
                                const updated = [...newTemplateTasks];
                                updated[index].dueOffsetDays = parseInt(e.target.value, 10) || 0;
                                setNewTemplateTasks(updated);
                              }}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  onClick={() => setActiveTab('browse')}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCustomTemplate}
                  disabled={isSavingTemplate}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-2"
                >
                  {isSavingTemplate ? (
                    <span>Saving Template...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Save Template</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
