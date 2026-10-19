import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { McpEngine, McpPolicyMode, McpServerPolicyDto, McpToolCache, McpToolItem, UpdateMcpPolicyDto } from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';

const ALL_ENGINES: { id: McpEngine; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'gemini', label: 'Gemini CLI' },
];

export function McpPage() {
  const qc = useQueryClient();
  const [fresh, setFresh] = useState(0);
  const q = useQuery<McpServerPolicyDto[]>({
    queryKey: ['mcp', fresh],
    queryFn: () => api<McpServerPolicyDto[]>(`/api/mcp/policy${fresh ? '?fresh=1' : ''}`),
    refetchInterval: 30_000,
  });

  const [client, setClient] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [text, setText] = useState('');

  // Dialog states
  const [prodConfirm, setProdConfirm] = useState<{
    server: McpServerPolicyDto;
    targetMode: McpPolicyMode;
  } | null>(null);

  const [toolPickerServer, setToolPickerServer] = useState<McpServerPolicyDto | null>(null);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [toolSearch, setToolSearch] = useState('');
  const [refreshingServer, setRefreshingServer] = useState<string | null>(null);

  const servers = q.data ?? [];
  const clients = useMemo(() => [...new Set(servers.map(s => s.client))].sort(), [servers]);
  const rows = servers.filter(
    s =>
      (!client || s.client === client) &&
      (!onlyEnabled || (s.policy?.mode && s.policy.mode !== 'off')) &&
      (!text || `${s.name} ${s.target} ${s.scope}`.toLowerCase().includes(text.toLowerCase())),
  );

  const activeInRunsCount = servers.filter(s => s.policy?.mode && s.policy.mode !== 'off').length;

  const updateMutation = useMutation({
    mutationFn: async ({ server, dto }: { server: string; dto: UpdateMcpPolicyDto }) => {
      return api(`/api/mcp/policy/${encodeURIComponent(server)}`, {
        method: 'PUT',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp'] });
    },
  });

  const refreshToolsMutation = useMutation({
    mutationFn: async (server: string) => {
      setRefreshingServer(server);
      try {
        return await api<McpToolCache>(`/api/mcp/servers/${encodeURIComponent(server)}/tools/refresh`, {
          method: 'POST',
        });
      } finally {
        setRefreshingServer(null);
      }
    },
    onSuccess: (data, serverName) => {
      qc.invalidateQueries({ queryKey: ['mcp'] });
      // If tool picker is open for this server, update local server representation
      if (toolPickerServer && toolPickerServer.name === serverName) {
        setToolPickerServer(prev => (prev ? { ...prev, cachedTools: data.tools, toolsReadAt: data.readAt } : null));
      }
    },
  });

  const handleModeChange = (s: McpServerPolicyDto, newMode: McpPolicyMode) => {
    const currentMode = s.policy?.mode ?? 'off';
    if (newMode === currentMode) return;

    // Check if prod confirmation is required:
    // Any server whose name or target matches /prod/i needs second confirmation when switching on
    if (s.isProd && currentMode === 'off' && (newMode === 'all' || newMode === 'tools')) {
      setProdConfirm({ server: s, targetMode: newMode });
      return;
    }

    applyPolicyUpdate(s, { mode: newMode });
  };

  const applyPolicyUpdate = (s: McpServerPolicyDto, partial: Partial<UpdateMcpPolicyDto>) => {
    const currentPolicy = s.policy;
    const mode = partial.mode ?? currentPolicy?.mode ?? 'off';
    const tools = partial.tools ?? currentPolicy?.tools ?? [];
    const engines = partial.engines ?? currentPolicy?.engines ?? ['claude', 'antigravity', 'gemini'];

    updateMutation.mutate({
      server: s.name,
      dto: { mode, tools, engines },
    });
  };

  const handleEngineToggle = (s: McpServerPolicyDto, engine: McpEngine) => {
    const currentEngines = s.policy?.engines ?? ['claude', 'antigravity', 'gemini'];
    const nextEngines = currentEngines.includes(engine)
      ? currentEngines.filter(e => e !== engine)
      : [...currentEngines, engine];

    applyPolicyUpdate(s, { engines: nextEngines });
  };

  const openToolPicker = (s: McpServerPolicyDto) => {
    setToolPickerServer(s);
    setSelectedTools(s.policy?.tools ?? []);
    setToolSearch('');
  };

  const saveToolPicker = () => {
    if (!toolPickerServer) return;
    applyPolicyUpdate(toolPickerServer, { tools: selectedTools });
    setToolPickerServer(null);
  };

  return (
    <Page
      title="MCP servers"
      description={
        q.data ? (
          <>
            {activeInRunsCount} active in runs / {servers.length} configured on this machine
          </>
        ) : (
          'Configure MCP permissions and engine access for workflow runs.'
        )
      }
      actions={
        <Button variant="outline" size="sm" onClick={() => setFresh(f => f + 1)}>
          <RefreshCw className="size-3.5" />
          Rescan
        </Button>
      }
    >
      <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-800 dark:text-sky-300">
        <strong>Antigravity policy note:</strong> Antigravity grants are synchronized globally to{' '}
        <code>~/.gemini/antigravity-cli/settings.json</code>. Rules configured here apply to all <code>agy</code> runs on this machine.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name, host, folder…"
          value={text}
          onChange={e => setText(e.target.value)}
          className="w-64"
        />
        <Select value={client} onChange={e => setClient(e.target.value)}>
          <option value="">All tools</option>
          {clients.map(c => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={onlyEnabled}
            onChange={e => setOnlyEnabled(e.target.checked)}
          />{' '}
          Active in runs only
        </label>
      </div>

      <Card>
        <QueryState
          isLoading={q.isLoading}
          error={q.error}
          empty={!q.isLoading && rows.length === 0}
          emptyText="No MCP servers match."
        />
        {rows.length > 0 && (
          <Table>
            <THead>
              <Tr>
                <Th>Server</Th>
                <Th>Client / Scope</Th>
                <Th>Run Policy</Th>
                <Th>Tools</Th>
                <Th>Engines</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map(s => {
                const mode: McpPolicyMode = s.policy?.mode ?? 'off';
                const currentEngines = s.policy?.engines ?? ['claude', 'antigravity', 'gemini'];
                const cachedCount = s.cachedTools?.length ?? 0;
                const chosenCount = s.policy?.tools.length ?? 0;
                const isRefreshing = refreshingServer === s.name;

                return (
                  <Tr key={s.id}>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{s.name}</span>
                        {s.isProd && (
                          <Badge variant="red" className="font-bold">
                            PROD
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {s.transport}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.target}
                        {s.envKeys.length > 0 && ` · env: ${s.envKeys.join(', ')}`}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <div className="text-sm font-medium">{s.client}</div>
                      <div className="max-w-xs truncate text-xs text-muted-foreground" title={s.file}>
                        {s.scope}
                      </div>
                    </Td>
                    <Td>
                      <Select
                        value={mode}
                        onChange={e => handleModeChange(s, e.target.value as McpPolicyMode)}
                        className="w-36 text-xs"
                      >
                        <option value="off">Off (Deny)</option>
                        <option value="all">All tools</option>
                        <option value="tools">Chosen tools</option>
                      </Select>
                    </Td>
                    <Td>
                      {mode === 'off' ? (
                        <span className="text-xs text-muted-foreground">–</span>
                      ) : mode === 'all' ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>All tools granted</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-xs"
                            onClick={() => refreshToolsMutation.mutate(s.name)}
                            disabled={isRefreshing}
                            title="Refresh tools from server"
                          >
                            <RefreshCw className={`size-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => openToolPicker(s)}
                          >
                            <Wrench className="size-3 mr-1" />
                            {chosenCount > 0 ? `${chosenCount} / ${cachedCount || '?'} tools` : 'Select tools'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-xs"
                            onClick={() => refreshToolsMutation.mutate(s.name)}
                            disabled={isRefreshing}
                            title="Refresh tools from server"
                          >
                            <RefreshCw className={`size-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        {ALL_ENGINES.map(e => (
                          <label
                            key={e.id}
                            className={`flex items-center gap-1 text-xs ${
                              mode === 'off' ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              disabled={mode === 'off'}
                              checked={currentEngines.includes(e.id)}
                              onChange={() => handleEngineToggle(s, e.id)}
                            />
                            {e.label}
                          </label>
                        ))}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Production Server Double Confirmation Modal */}
      {prodConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[92vh] w-full max-w-md flex-col gap-3 rounded-xl border border-red-500/50 bg-card p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="size-5" />
              <h3 className="font-semibold text-base">Production MCP Server Confirmation</h3>
            </div>
            <p className="text-sm text-foreground/80">
              The server <strong className="text-foreground">{prodConfirm.server.name}</strong> target (
              <code>{prodConfirm.server.target}</code>) appears to be a <strong>Production</strong> environment.
            </p>
            <p className="text-sm text-muted-foreground">
              Enabling this server allows AI agent runs to invoke tools and interact with production resources. Are you
              sure you want to grant access?
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setProdConfirm(null)}>
                Cancel (Keep Off)
              </Button>
              <Button
                variant="default"
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  const target = prodConfirm;
                  setProdConfirm(null);
                  applyPolicyUpdate(target.server, { mode: target.targetMode });
                }}
              >
                Yes, Enable in Runs
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tool Picker Modal */}
      {toolPickerServer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={() => setToolPickerServer(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-hidden rounded-xl border bg-card p-5 shadow-2xl"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Tools for {toolPickerServer.name}</h3>
                <p className="text-xs text-muted-foreground">
                  Select which tools workflow runs may call from this server.
                </p>
              </div>
              <button
                className="rounded p-1 hover:bg-accent text-muted-foreground hover:text-foreground"
                onClick={() => setToolPickerServer(null)}
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Input
                placeholder="Search tools…"
                value={toolSearch}
                onChange={e => setToolSearch(e.target.value)}
                className="h-8 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs whitespace-nowrap"
                onClick={() => refreshToolsMutation.mutate(toolPickerServer.name)}
                disabled={refreshingServer === toolPickerServer.name}
              >
                {refreshingServer === toolPickerServer.name ? (
                  <Loader2 className="size-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="size-3 mr-1" />
                )}
                Refresh tools
              </Button>
            </div>

            <div className="max-h-80 overflow-y-auto rounded border p-2 flex flex-col gap-1.5">
              {toolPickerServer.cachedTools && toolPickerServer.cachedTools.length > 0 ? (
                toolPickerServer.cachedTools
                  .filter(
                    t =>
                      !toolSearch ||
                      t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
                      t.description?.toLowerCase().includes(toolSearch.toLowerCase()),
                  )
                  .map(t => {
                    const isChecked = selectedTools.includes(t.name);
                    return (
                      <label
                        key={t.name}
                        className="flex items-start gap-2 rounded p-1.5 hover:bg-accent cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedTools(prev => [...prev, t.name]);
                            } else {
                              setSelectedTools(prev => prev.filter(x => x !== t.name));
                            }
                          }}
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-medium font-mono">{t.name}</span>
                          {t.description && (
                            <span className="text-[11px] text-muted-foreground">{t.description}</span>
                          )}
                        </div>
                      </label>
                    );
                  })
              ) : (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No cached tools found. Click "Refresh tools" to query the server via JSON-RPC.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-muted-foreground">
                {selectedTools.length} tool(s) selected
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setToolPickerServer(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveToolPicker}>
                  Save Tools
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
