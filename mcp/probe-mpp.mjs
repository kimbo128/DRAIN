const endpoints = [
  { name: 'Tavily (Locus)', url: 'https://tavily.mpp.paywithlocus.com/tavily/search', body: {query:'test'} },
  { name: 'Brave Search (Locus)', url: 'https://brave.mpp.paywithlocus.com/', body: {q:'test'} },
  { name: 'DeepSeek (Locus)', url: 'https://deepseek.mpp.paywithlocus.com/', body: {messages:[{role:'user',content:'hi'}]} },
  { name: 'OpenAI (Tempo)', url: 'https://openai.mpp.tempo.xyz/v1/chat/completions', body: {messages:[{role:'user',content:'hi'}],model:'gpt-4o-mini'} },
  { name: 'Anthropic (Tempo)', url: 'https://anthropic.mpp.tempo.xyz/v1/messages', body: {messages:[{role:'user',content:'hi'}],model:'claude-3-haiku-20240307',max_tokens:10} },
  { name: 'Groq (Locus)', url: 'https://groq.mpp.paywithlocus.com/', body: {messages:[{role:'user',content:'hi'}]} },
  { name: 'Firecrawl (Tempo)', url: 'https://firecrawl.mpp.tempo.xyz/', body: {url:'https://example.com'} },
  { name: 'Exa (Tempo)', url: 'https://exa.mpp.tempo.xyz/', body: {query:'test'} },
  { name: 'Wolfram (Locus)', url: 'https://wolframalpha.mpp.paywithlocus.com/', body: {query:'2+2'} },
  { name: 'CoinGecko (Locus)', url: 'https://coingecko.mpp.paywithlocus.com/', body: {} },
  { name: 'Stripe Climate', url: 'https://climate.stripe.dev/', body: {} },
  { name: 'Alchemy', url: 'https://mpp.alchemy.com/', body: {} },
  { name: 'fal.ai (Tempo)', url: 'https://fal.mpp.tempo.xyz/', body: {} },
  { name: 'Replicate (Locus)', url: 'https://replicate.mpp.paywithlocus.com/', body: {} },
  { name: 'Browserbase', url: 'https://mpp.browserbase.com/', body: {} },
];

async function probe(ep) {
  try {
    const r = await fetch(ep.url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(ep.body),
    });
    const wwwAuth = r.headers.get('www-authenticate') || '';
    const bodyText = await r.text().catch(() => '');

    let method = '-', intent = '-', amount = '-', chainId = '-', currency = '-', desc = '-';
    if (wwwAuth) {
      const mm = wwwAuth.match(/method="([^"]+)"/);
      const im = wwwAuth.match(/intent="([^"]+)"/);
      const dm = wwwAuth.match(/description="([^"]+)"/);
      if (mm) method = mm[1];
      if (im) intent = im[1];
      if (dm) desc = dm[1];
      const rm = wwwAuth.match(/request="([^"]+)"/);
      if (rm) {
        try {
          const decoded = JSON.parse(Buffer.from(rm[1], 'base64').toString());
          amount = decoded.amount || '-';
          currency = decoded.currency || '-';
          if (decoded.methodDetails) chainId = decoded.methodDetails.chainId || '-';
        } catch(e) { /* ignore */ }
      }
    }

    return {
      name: ep.name,
      status: r.status,
      method,
      intent,
      amount,
      currency: typeof currency === 'string' ? currency.slice(0, 20) : currency,
      chainId,
      desc,
      hasAuth: !!wwwAuth,
      bodySnippet: r.status !== 402 ? bodyText.slice(0, 150) : '',
    };
  } catch(e) {
    return { name: ep.name, status: 'ERR', error: e.message };
  }
}

const results = await Promise.all(endpoints.map(probe));

console.log('\n=== MPP Provider 402 Probe Results ===\n');
for (const r of results) {
  console.log(`${r.name}`);
  console.log(`  HTTP: ${r.status} | Method: ${r.method} | Intent: ${r.intent}`);
  console.log(`  Amount: ${r.amount} | Chain: ${r.chainId} | Currency: ${r.currency}`);
  if (r.desc !== '-') console.log(`  Desc: ${r.desc}`);
  if (r.hasAuth === false && r.status !== 402) console.log(`  NO WWW-Auth header!`);
  if (r.bodySnippet) console.log(`  Body: ${r.bodySnippet}`);
  if (r.error) console.log(`  Error: ${r.error}`);
  console.log('');
}

// Summary
const by402 = results.filter(r => r.status === 402);
const byOther = results.filter(r => r.status !== 402);
const methods = [...new Set(by402.map(r => r.method))];
const chains = [...new Set(by402.map(r => r.chainId))];
const intents = [...new Set(by402.map(r => r.intent))];

console.log('=== SUMMARY ===');
console.log(`402 responses: ${by402.length}/${results.length}`);
console.log(`Non-402: ${byOther.map(r => `${r.name}(${r.status})`).join(', ')}`);
console.log(`Payment methods: ${methods.join(', ')}`);
console.log(`Chain IDs: ${chains.join(', ')}`);
console.log(`Intents: ${intents.join(', ')}`);
