require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// ---------- Simple in-memory menu (stock resets when server restarts) ----------
const menu = {
  'cheese':      { price: 8,  stock: { small: 10, medium: 10, large: 10 } },
  'margherita':  { price: 9,  stock: { small: 5,  medium: 5,  large: 0  } }, // large is out of stock (for demo)
  'veg supreme': { price: 11, stock: { small: 4,  medium: 4,  large: 4  } },
};

const findFlavour = (name = '') => {
  const n = String(name).toLowerCase().trim();
  return Object.keys(menu).find((k) => n.includes(k) || k.includes(n));
};

// ---------- Orders saved to a file ----------
const loadOrders = () => {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return []; }
};
const saveOrders = (orders) => fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));

// ---------- Tool logic ----------
function checkAvailability({ flavour, size, quantity }) {
  const f = findFlavour(flavour);
  if (!f) return `Sorry, we don't have ${flavour}. Our flavours are: ${Object.keys(menu).join(', ')}.`;
  const s = String(size || '').toLowerCase();
  const qty = Number(quantity) || 1;
  if (!menu[f].stock[s] && menu[f].stock[s] !== 0) return `Please choose a size: small, medium or large.`;
  const left = menu[f].stock[s];
  if (left >= qty) return `Yes, ${qty} ${s} ${f} pizza is available. Price is ${menu[f].price * qty} dollars in total.`;
  if (left > 0) return `Only ${left} ${s} ${f} pizza left. Not enough for ${qty}.`;
  const others = Object.keys(menu[f].stock).filter((x) => menu[f].stock[x] > 0);
  return `Sorry, ${s} ${f} is out of stock. Available sizes: ${others.join(', ') || 'none'}.`;
}

function placeOrder({ flavour, size, quantity, customerName }) {
  const f = findFlavour(flavour);
  const s = String(size || '').toLowerCase();
  const qty = Number(quantity) || 1;
  if (!f || menu[f].stock[s] === undefined) return 'Could not place the order, item not found.';
  if (menu[f].stock[s] < qty) return 'Could not place the order, not enough stock.';
  menu[f].stock[s] -= qty;
  const orders = loadOrders();
  const order = {
    id: 'ORD-' + (orders.length + 1001),
    customerName: customerName || 'Guest',
    flavour: f, size: s, quantity: qty,
    total: menu[f].price * qty,
    time: new Date().toISOString(),
  };
  orders.push(order);
  saveOrders(orders);
  console.log('NEW ORDER:', order);
  return `Order placed. Your order number is ${order.id}. Total is ${order.total} dollars.`;
}

const tools = { check_availability: checkAvailability, place_order: placeOrder };

// ---------- Vapi webhook (Vapi calls this when the AI uses a tool) ----------
app.post('/vapi/webhook', (req, res) => {
  const msg = req.body.message || {};
  if (msg.type === 'tool-calls') {
    const calls = msg.toolCallList ||
      (msg.toolCalls || []).map((c) => ({ id: c.id, name: c.function?.name, arguments: c.function?.arguments }));

    const results = calls.map((c) => {
      let args = c.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      console.log('TOOL CALL:', c.name, args);
      const fn = tools[c.name];
      return { toolCallId: c.id, result: fn ? fn(args) : 'Unknown tool.' };
    });
    return res.json({ results });
  }
  if (msg.type === 'end-of-call-report') console.log('CALL ENDED. Summary:', msg.summary || '(none)');
  res.json({});
});

// ---------- API for the web page ----------
app.get('/api/config', (req, res) =>
  res.json({ publicKey: process.env.VAPI_PUBLIC_KEY, assistantId: process.env.ASSISTANT_ID }));
app.get('/api/menu', (req, res) => res.json(menu));
app.get('/api/orders', (req, res) => res.json(loadOrders().slice().reverse()));

// Serve ONLY the web page (never the whole folder, it contains your .env secrets)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
