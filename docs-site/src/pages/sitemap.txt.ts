import { getCollection } from 'astro:content';

const SITE_URL = 'https://docs.tfstudio.xyz';

export async function GET() {
  const docs = await getCollection('docs');
  const urls = docs
    .map(({ id }) => id === 'index' ? `${SITE_URL}/` : `${SITE_URL}/${id}/`)
    .sort();

  return new Response(`${urls.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
