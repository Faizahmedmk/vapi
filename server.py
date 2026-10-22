import csv
import json
import os
from datetime import datetime

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file

load_dotenv()

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INVENTORY_FILE = os.path.join(BASE_DIR, "inventory.csv")
ORDERS_FILE = os.path.join(BASE_DIR, "orders.csv")
PORT = int(os.getenv("PORT", 3000))

INVENTORY_COLS = ["flavour", "size", "price", "stock"]
ORDER_COLS = ["order_id", "time", "customer_name", "flavour", "size", "quantity", "unit_price", "total", "status"]


# ---------- CSV helpers ----------
def read_inventory():
    with open(INVENTORY_FILE, newline="", encoding="utf-8-sig") as f:
        rows = []
        for r in csv.DictReader(f):
            rows.append({
                "flavour": r["flavour"].strip().lower(),
                "size": r["size"].strip().lower(),
                "price": float(r["price"]),
                "stock": int(float(r["stock"])),
            })
        return rows


def write_inventory(rows):
    with open(INVENTORY_FILE, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=INVENTORY_COLS)
        w.writeheader()
        for r in rows:
            w.writerow({**r, "price": int(r["price"]) if r["price"] == int(r["price"]) else r["price"]})


def read_orders():
    if not os.path.exists(ORDERS_FILE):
        return []
    with open(ORDERS_FILE, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def append_order(order):
    new_file = not os.path.exists(ORDERS_FILE)
    with open(ORDERS_FILE, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=ORDER_COLS)
        if new_file:
            w.writeheader()
        w.writerow(order)


def match_flavour(name, rows):
    n = str(name or "").lower().strip()
    if not n:
        return None
    for fl in sorted({r["flavour"] for r in rows}):
        if n in fl or fl in n:
            return fl
    return None


def to_qty(v):
    try:
        return max(1, int(float(v)))
    except (TypeError, ValueError):
        return 1


# ---------- Tool logic (reads the CSV every time, so edits in Excel apply instantly) ----------
def check_availability(args):
    rows = read_inventory()
    fl = match_flavour(args.get("flavour"), rows)
    flavours = sorted({r["flavour"] for r in rows})
    if not fl:
        return f"Sorry, we don't have {args.get('flavour')}. Our flavours are: {', '.join(flavours)}."
    size = str(args.get("size", "")).lower().strip()
    qty = to_qty(args.get("quantity"))
    row = next((r for r in rows if r["flavour"] == fl and r["size"] == size), None)
    if not row:
        sizes = [r["size"] for r in rows if r["flavour"] == fl]
        return f"Please choose a size for {fl}: {', '.join(sizes)}."
    if row["stock"] >= qty:
        total = row["price"] * qty
        return f"Yes, {qty} {size} {fl} pizza is available. Total price is {total:g} dollars."
    if row["stock"] > 0:
        return f"Only {row['stock']} {size} {fl} pizza left. Not enough for {qty}."
    others = [r["size"] for r in rows if r["flavour"] == fl and r["stock"] > 0]
    return f"Sorry, {size} {fl} is out of stock. Available sizes: {', '.join(others) or 'none'}."


def place_order(args):
    rows = read_inventory()
    fl = match_flavour(args.get("flavour"), rows)
    size = str(args.get("size", "")).lower().strip()
    qty = to_qty(args.get("quantity"))
    row = next((r for r in rows if r["flavour"] == fl and r["size"] == size), None)
    if not row:
        return "Could not place the order, item not found."
    if row["stock"] < qty:
        return "Could not place the order, not enough stock."
    row["stock"] -= qty
    write_inventory(rows)
    order_id = f"ORD-{len(read_orders()) + 1001}"
    order = {
        "order_id": order_id,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "customer_name": args.get("customerName") or "Guest",
        "flavour": fl,
        "size": size,
        "quantity": qty,
        "unit_price": f"{row['price']:g}",
        "total": f"{row['price'] * qty:g}",
        "status": "confirmed",
    }
    append_order(order)
    print("NEW ORDER:", order, flush=True)
    return f"Order placed. Your order number is {order_id}. Total is {order['total']} dollars."


TOOLS = {"check_availability": check_availability, "place_order": place_order}


# ---------- Read Vapi's tool-call message (handles all known formats) ----------
def parse_args(raw):
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    return raw if isinstance(raw, dict) else {}


def extract_calls(msg):
    items = []
    for c in msg.get("toolCallList") or []:
        items.append(c)
    if not items:
        for c in msg.get("toolWithToolCallList") or []:
            items.append(c.get("toolCall") or c)
    if not items:
        for c in msg.get("toolCalls") or []:
            items.append(c)

    calls = []
    for c in items:
        fn = c.get("function") or {}
        name = c.get("name") or fn.get("name")
        raw = c.get("arguments") or c.get("parameters") or fn.get("arguments") or fn.get("parameters") or {}
        calls.append({"id": c.get("id"), "name": name, "args": parse_args(raw)})
    return calls


# ---------- Vapi webhook ----------
@app.post("/vapi/webhook")
def vapi_webhook():
    body = request.get_json(silent=True) or {}
    msg = body.get("message", {})
    print("WEBHOOK HIT:", msg.get("type"), flush=True)

    if msg.get("type") == "tool-calls":
        print("RAW:", json.dumps(msg)[:700], flush=True)
        results = []
        for c in extract_calls(msg):
            print("TOOL CALL:", c["name"], c["args"], flush=True)
            fn = TOOLS.get(c["name"])
            try:
                result = fn(c["args"]) if fn else "Unknown tool."
            except PermissionError:
                result = "Sorry, the inventory file is busy. Please try again in a moment."
            except Exception as e:  # never crash the call
                print("TOOL ERROR:", repr(e), flush=True)
                result = "Sorry, something went wrong while checking. Please try again."
            print("RESULT:", result, flush=True)
            results.append({"toolCallId": c["id"], "result": result})
        return jsonify({"results": results})

    if msg.get("type") == "end-of-call-report":
        print("CALL ENDED. Summary:", msg.get("summary", "(none)"), flush=True)
    return jsonify({})


# ---------- API for the web page ----------
@app.get("/api/config")
def api_config():
    return jsonify({"publicKey": os.getenv("VAPI_PUBLIC_KEY"), "assistantId": os.getenv("ASSISTANT_ID")})


@app.get("/api/orders")
def api_orders():
    try:
        return jsonify(list(reversed(read_orders())))
    except PermissionError:
        return jsonify([])


# Serve ONLY the web page (never the whole folder, it contains your .env secrets)
@app.get("/")
def home():
    return send_file(os.path.join(BASE_DIR, "index.html"))


if __name__ == "__main__":
    print(f"Server running on http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT)