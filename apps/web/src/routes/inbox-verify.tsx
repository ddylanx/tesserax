import type { PipelineRunDetail } from '@ot/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Result of the playbook run; verification actions arrive in a later stage. */
export function VerifyPanel({ run }: { run: PipelineRunDetail }) {
  return (
    <Card>
      <CardHeader><CardTitle>Result</CardTitle></CardHeader>
      <CardContent className="text-sm">
        <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">{run.result?.summary ?? '(no summary)'}</pre>
      </CardContent>
    </Card>
  );
}
