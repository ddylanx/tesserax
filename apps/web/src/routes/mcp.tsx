import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { McpList } from '@ot/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';

export function McpPage() {
  const [fresh, setFresh] = useState(0);
  const q = useQuery({
    queryKey: ['mcp', fresh],
    queryFn: () => api<McpList>(`/api/mcp/servers${fresh ? '?fresh=1' : ''}`),
    refetchInterval: 30_000,
  });
  const [client, setClient] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(true);
  const [text, setText] = useState('');

  const servers = q.data?.servers ?? [];
  const clients = useMemo(() => [...new Set(servers.map(s => s.client))].sort(), [servers]);
  const rows = servers.filter(
    s => (!client || s.client === client) && (!onlyEnabled || s.enabled) && (!text || `${s.name} ${s.target} ${s.scope}`.toLowerCase().includes(text.toLowerCase())),
  );
  const enabledCount = servers.filter(s => s.enabled).length;

  return (
    <Page
      title="MCP servers"
      description={q.data ? <>{enabledCount} on / {servers.length} configured · read from local configs via <code>{q.data.provider}</code></> : 'Read-only list from the MCP configs on this machine.'}
      actions={<Button variant="outline" size="sm" onClick={() => setFresh(f => f + 1)}><RefreshCw className="size-3.5" />Rescan</Button>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search name, host, folder…" value={text} onChange={e => setText(e.target.value)} className="w-64" />
        <Select value={client} onChange={e => setClient(e.target.value)}>
          <option value="">All tools</option>
          {clients.map(c => <option key={c}>{c}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyEnabled} onChange={e => setOnlyEnabled(e.target.checked)} /> Enabled only
        </label>
      </div>
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} empty={!q.isLoading && rows.length === 0} emptyText="No MCP servers match." />
        {rows.length > 0 && (
          <Table>
            <THead><Tr><Th>Server</Th><Th>Tool</Th><Th>Scope</Th><Th>Transport</Th><Th>State</Th></Tr></THead>
            <TBody>
              {rows.map(s => (
                <Tr key={s.id}>
                  <Td>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.target}{s.envKeys.length > 0 && ` · env: ${s.envKeys.join(', ')}`}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{s.client}</Td>
                  <Td><div className="max-w-xs truncate text-xs" title={s.file}>{s.scope}</div></Td>
                  <Td><Badge variant="outline">{s.transport}</Badge></Td>
                  <Td><Badge variant={s.enabled ? 'green' : 'default'}>{s.enabled ? 'on' : 'off'}</Badge></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </Page>
  );
}
