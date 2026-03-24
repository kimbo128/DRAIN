const endpoints = [
  // Locus-hosted (correct paths from docs)
  { name: 'Brave Search', url: 'https://brave.mpp.paywithlocus.com/brave/web-search', body: {q:'AI agents 2026'} },
  { name: 'Wolfram Short', url: 'https://wolframalpha.mpp.paywithlocus.com/wolframalpha/short-answer', body: {i:'2+2'} },
  { name: 'DeepSeek Chat', url: 'https://deepseek.mpp.paywithlocus.com/deepseek/chat', body: {model:'deepseek-chat', messages:[{role:'user',content:'hi'}]} },
  { name: 'Tavily Search', url: 'https://tavily.mpp.paywithlocus.com/tavily/search', body: {query:'test'} },
  { name: 'CoinGecko', url: 'https://coingecko.mpp.paywithlocus.com/coingecko/coins-list', body: {} },
  { name: 'Groq Chat', url: 'https://groq.mpp.paywithlocus.com/groq/chat', body: {model:'llama-3.3-70b-versatile', messages:[{role:'user',content:'hi'}]} },
  { name: 'Replicate', url: 'https://replicate.mpp.paywithlocus.com/replicate/run', body: {} },
  
  // Tempo-hosted (OpenAI-compatible paths)
  { name: 'OpenAI Chat', url: 'https://openai.mpp.tempo.xyz/v1/chat/completions', body: {model:'gpt-4o-mini', messages:[{role:'user',content:'hi'}]} },
  { name: 'Anthropic', url: 'https://anthropic.mpp.tempo.xyz/v1/messages', body: {model:'claude-3-haiku-20240307', messages:[{role:'user',content:'hi'}], max_tokens:10} },
  { name: 'Gemini', url: 'https://gemini.mpp.tempo.xyz/v1/chat/completions', body: {model:'gemini-2.0-flash', messages:[{role:'user',content:'hi'}]} },
  { name: 'OpenRouter', url: 'https://openrouter.mpp.tempo.xyz/v1/chat/completions', body: {model:'meta-llama/llama-3.3-70b-instruct', messages:[{role:'user',content:'hi'}]} },
  
  // Self-hosted
  { name: 'Stripe Climate', url: 'https://climate.stripe.dev/v1/climate/orders', body: {} },
  { name: 'Alchemy', url: 'https://mpp.alchemy.com/v1/transfers', body: {} },
  { name: 'Browserbase', url: 'https://mpp.browserbase.com/v1/sessions', body: {} },
];

const results = [];

for (const ep of endpoints) {
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
          if (decoded.methodDetails) chainId = String(decoded.methodDetails.chainId || '-');
        } catch(e) { /* ignore */ }
      }
    }

    results.push({
      name: ep.name,
      status: r.status,
      method, intent, amount, chainId, desc,
      body: r.status !== 402 ? bodyText.slice(0, 120) : '',
    });
  } catch(e) {
    results.push({ name: ep.name, status: 'ERR', error: e.message });
  }
}

console.log('\n=== MPP 402 Probe (Correct Paths) ===\n');
console.log('Provider'.padEnd(20), 'HTTP'.padEnd(6), 'Method'.padEnd(10), 'Intent'.padEnd(10), 'Amount'.padEnd(10), 'Chain'.padEnd(8));
console.log('-'.repeat(70));
for (const r of results) {
  console.log(
    r.name.padEnd(20),
    String(r.status).padEnd(6),
    (r.method || '-').padEnd(10),
    (r.intent || '-').padEnd(10),
    (r.amount || '-').padEnd(10),
    (r.chainId || '-').padEnd(8),
  );
  if (r.body) console.log('  > ' + r.body);
  if (r.error) console.log('  > ERR: ' + r.error);
  if (r.desc && r.desc !== '-') console.log('  > Desc: ' + r.desc);
}

// Summary
const got402 = results.filter(r => r.status === 402);
const notGot402 = results.filter(r => r.status !== 402);
const methods = [...new Set(got402.map(r => r.method))];
const chains = [...new Set(got402.map(r => r.chainId))];
const intents = [...new Set(got402.map(r => r.intent))];
const amounts = got402.map(r => `${r.name}=${r.amount}`);

console.log('\n=== SUMMARY ===');
console.log(`402: ${got402.length}/${results.length}`);
console.log(`Methods: ${methods.join(', ')}`);
console.log(`Chains: ${chains.join(', ')}`);
console.log(`Intents: ${intents.join(', ')}`);
console.log(`Amounts: ${amounts.join(', ')}`);
if (notGot402.length) console.log(`Non-402: ${notGot402.map(r => `${r.name}(${r.status})`).join(', ')}`);
