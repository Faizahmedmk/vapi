require('dotenv').config();
const { VapiClient } = require('@vapi-ai/server-sdk');

const vapi = new VapiClient({ token: process.env.VAPI_API_KEY });

async function main() {
  const assistants = await vapi.assistants.list();
  console.log(assistants);
}
main();