import path from 'node:path';
import { canReadEvidence, readEvidenceFile } from '@/lib/evidence';
import { currentUser } from '@/lib/session';

const TYPES: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function GET(_req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const { ref } = await ctx.params;
  const name = path.basename(decodeURIComponent(ref));

  // Evidence is performance-review material. Knowing the URL is not
  // authorisation: the viewer must be the employee it concerns, the reviewer or
  // approver it is routed to, or HR. 404 rather than 403 so the response does
  // not confirm that a document exists to someone who may not see it.
  const viewer = await currentUser();
  if (!(await canReadEvidence(viewer, name))) {
    return new Response('Not found', { status: 404 });
  }

  const body = await readEvidenceFile(name);
  if (!body) {
    return new Response('Not found', { status: 404 });
  }

  const ext = path.extname(name).toLowerCase();
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${name}"`,
      // Review material must not be cached by shared proxies.
      'Cache-Control': 'private, no-store',
    },
  });
}
