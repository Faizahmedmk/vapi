require('dotenv').config();

const API = 'https://api.vapi.ai/assistant';
const { VAPI_API_KEY, PUBLIC_URL, ASSISTANT_ID } = process.env;

if (!VAPI_API_KEY || !PUBLIC_URL) {
  console.error('Missing VAPI_API_KEY or PUBLIC_URL in .env');
  process.exit(1);
}

const serverUrl = `${PUBLIC_URL.replace(/\/$/, '')}/vapi/webhook`;

const systemPrompt = `You are a friendly phone assistant for Pizza Point.
Menu flavours: Cheese, Margherita, Veg Supreme. Sizes: small, medium, large.

Follow this flow, asking ONE question at a time:
1. Ask which pizza flavour.
2. Ask the quantity.
3. Ask the size.
4. Call the check_availability tool. If not available, say so and offer other sizes or flavours.
5. If available, ask the customer's name, then repeat the full order with the total price and ask for confirmation.
6. Only after the customer says yes, call the place_order tool and tell them the order number.
7. Thank them and end the call politely.

Never say an item is available without calling check_availability first.
Keep every reply under 30 words.`;

const body = {
  name: 'Pizza Order Assistant',
  firstMessage: 'Hello! Welcome to Pizza Point. What would you like to order today?',
  model: {
    provider: 'openai',
    model: 'gpt-4.1',
    messages: [{ role: 'system', content: systemPrompt }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'check_availability',
          description: 'Check if a pizza flavour, size and quantity is in stock.',
          parameters: {
            type: 'object',
            properties: {
              flavour: { type: 'string', description: 'cheese, margherita or veg supreme' },
              size: { type: 'string', enum: ['small', 'medium', 'large'] },
              quantity: { type: 'number' },
            },
            required: ['flavour', 'size', 'quantity'],
          },
        },
        server: { url: serverUrl },
      },
      {
        type: 'function',
        function: {
          name: 'place_order',
          description: 'Place the final order after the customer has confirmed.',
          parameters: {
            type: 'object',
            properties: {
              flavour: { type: 'string' },
              size: { type: 'string', enum: ['small', 'medium', 'large'] },
              quantity: { type: 'number' },
              customerName: { type: 'string' },
            },
            required: ['flavour', 'size', 'quantity', 'customerName'],
          },
        },
        server: { url: serverUrl },
      },
    ],
  },
  voice: { provider: 'vapi', voiceId: 'Elliot' },
  server: { url: serverUrl }, // also receives end-of-call reports
};

(async () => {
  const update = Boolean(ASSISTANT_ID);
  const res = await fetch(update ? `${API}/${ASSISTANT_ID}` : API, {
    method: update ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Vapi error:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log(update ? 'Assistant UPDATED.' : 'Assistant CREATED.');
  console.log('ASSISTANT_ID =', data.id);
  console.log('Tool server URL =', serverUrl);
  if (!update) console.log('\nNow paste ASSISTANT_ID into your .env file.');
})();
