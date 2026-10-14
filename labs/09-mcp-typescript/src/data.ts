// Sample data (same as the Python lab) so both servers answer identically.
export interface Pod { name: string; namespace: string; phase: string; restarts: number; node: string; cpuRequestM: number; memRequestMi: number }

export class BackendError extends Error {}

const PODS: Record<string, Pod[]> = {
  payments: [
    { name: 'payments-api-7c9f-abcde', namespace: 'payments', phase: 'Running', restarts: 0, node: 'ip-10-0-1-12', cpuRequestM: 500, memRequestMi: 512 },
    { name: 'payments-api-7c9f-fghij', namespace: 'payments', phase: 'Running', restarts: 4, node: 'ip-10-0-1-13', cpuRequestM: 500, memRequestMi: 512 },
    { name: 'payments-worker-5d8b-klmno', namespace: 'payments', phase: 'CrashLoopBackOff', restarts: 17, node: 'ip-10-0-2-21', cpuRequestM: 250, memRequestMi: 256 },
  ],
  search: [{ name: 'search-vllm-0', namespace: 'search', phase: 'Running', restarts: 0, node: 'gpu-node-a', cpuRequestM: 8000, memRequestMi: 65536 }],
};

export async function listPods(namespace: string): Promise<Pod[]> {
  const pods = PODS[namespace];
  if (!pods) throw new BackendError(`namespace '${namespace}' not found`);
  return pods;
}
