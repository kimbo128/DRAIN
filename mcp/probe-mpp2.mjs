const providers = [
  { name: 'Brave Search', base: 'https://brave.mpp.paywithlocus.com' },
  { name: 'DeepSeek', base: 'https://deepseek.mpp.paywithlocus.com' },
  { name: 'Groq', base: 'https://groq.mpp.paywithlocus.com' },
  { name: 'Wolfram', base: 'https://wolframalpha.mpp.paywithlocus.com' },
  { name: 'CoinGecko', base: 'https://coingecko.mpp.paywithlocus.com' },
  { name: 'Replicate', base: 'https://replicate.mpp.paywithlocus.com' },
  { name: 'Exa', base: 'https://exa.mpp.tempo.xyz' },
  { name: 'Firecrawl', base: 'https://firecrawl.mpp.tempo.xyz' },
  { name: 'fal.ai', base: 'https://fal.mpp.tempo.xyz' },
  { name: 'OpenRouter (Tempo)', base: 'https://openrouter.mpp.tempo.xyz' },
  { name: 'Suno', base: 'https://suno.mpp.paywithlocus.com' },
  { name: 'Stability AI', base: 'https://stability-ai.mpp.paywithlocus.com' },
];

console.log('=== Fetching skill.md / llms.txt from MPP providers ===\n');

for (const p of providers) {
  console.log(`--- ${p.name} ---`);
  
  // Try skill.md
  for (const path of ['/skill.md', '/llms.txt', '/.well-known/mpp.json']) {
    try {
      const r = await fetch(p.base + path, { method: 'GET' });
      if (r.ok) {
        const text = await r.text();
        console.log(`  ${path} (${r.status}):`);
        // Show first 500 chars
        console.log(text.slice(0, 600));
        console.log('  ...\n');
        break; // Only show first working one
      } else {
        console.log(`  ${path}: ${r.status}`);
      }
    } catch(e) {
      console.log(`  ${path}: ERR ${e.message}`);
    }
  }
  console.log('');
}
