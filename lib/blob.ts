import { get } from '@vercel/blob';

export async function readBlob(url: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const res = await get(url, { access: 'private' });
  if (!res || res.statusCode !== 200) throw new Error('Recording not found in Blob');
  const data = await new Response(res.stream).arrayBuffer();
  return { data, contentType: res.blob.contentType || 'audio/mpeg' };
}
