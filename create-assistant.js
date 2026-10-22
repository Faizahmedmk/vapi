require('dotenv').config();
const { VapiClient } = require('@vapi-ai/server-sdk');

const vapi = new VapiClient({ token: process.env.VAPI_API_KEY });

async function main() {
  const assistant = await vapi.assistants.create({
    name: 'Pizza Order Assistant',
    firstMessage: 'Hello! Welcome to Pizza Town. What would you like to order today?',
    model: {
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a friendly phone assistant for a pizza shop.
Help the caller order a pizza. Ask one question at a time:
1. Which pizza and flavour (Cheese, Margherita, Veg Supreme).
2. Quantity.
3. Size (small, medium, large).
Then repeat the full order and ask for confirmation.
Keep every reply under 30 words.`,
        },
      ],
    },
    voice: { provider: 'vapi', voiceId: 'Elliot' },
  });

  console.log('Created! Assistant ID:', assistant.id);
}
main();