import asyncio
import base64
import os
import requests
from bleak import BleakScanner, BleakClient

DEVICE_NAME = "Atom"
TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
OUTPUT = "page.jpg"

PROMPT = """Read aloud the text in this image in natural reading order.
If it is a book page, read only the body text - skip headers, footers, and page numbers.
Rejoin words that are hyphenated across line breaks.
If there is no text, briefly describe what you see instead.
Output only the text to be spoken, nothing else."""

buffer = bytearray()
expected = None
done = asyncio.Event()


def on_notify(_sender, data):
    global expected
    if expected is None:
        expected = int.from_bytes(data[:4], "little")
        print(f"Incoming image: {expected} bytes")
        return

    buffer.extend(data)
    pct = len(buffer) * 100 // expected
    print(f"\r  {len(buffer)}/{expected} bytes ({pct}%)", end="")

    if len(buffer) >= expected:
        done.set()


def read_with_gemini(jpeg, api_key):
    url = ("https://generativelanguage.googleapis.com/v1beta/"
           "models/gemini-3.6-flash:generateContent")
    body = {
        "contents": [{
            "parts": [
                {"text": PROMPT},
                {"inline_data": {
                    "mime_type": "image/jpeg",
                    "data": base64.b64encode(jpeg).decode(),
                }},
            ]
        }]
    }
    r = requests.post(
        url,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=body,
        timeout=90,
    )
    data = r.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        return " ".join(p["text"] for p in parts if "text" in p)
    except (KeyError, IndexError):
        return f"[Gemini returned no text: {str(data)[:300]}]"


async def main():
    print(f"Scanning for '{DEVICE_NAME}'...")
    device = await BleakScanner.find_device_by_name(DEVICE_NAME, timeout=15.0)
    if device is None:
        print("Not found. Board powered? Phone disconnected?")
        return

    print(f"Found {device.address}. Connecting...")
    async with BleakClient(device) as client:
        print("Connected.")
        await client.start_notify(TX_UUID, on_notify)
        print("Asking for a photo...")
        await client.write_gatt_char(RX_UUID, b"photo", response=True)

        try:
            await asyncio.wait_for(done.wait(), timeout=90.0)
        except asyncio.TimeoutError:
            print(f"\nTimed out with {len(buffer)} of {expected} bytes.")
            return

        await client.stop_notify(TX_UUID)

    print()
    image = bytes(buffer[:expected])

    if image[:2] == b"\xff\xd8" and image[-2:] == b"\xff\xd9":
        print("JPEG markers OK.")
    else:
        print("WARNING: JPEG markers missing - image may be corrupt.")

    with open(OUTPUT, "wb") as f:
        f.write(image)
    print(f"Saved {len(image)} bytes to {OUTPUT}")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("No GEMINI_API_KEY set - skipping transcription.")
        return

    print("\nSending to Gemini...\n")
    print(read_with_gemini(image, api_key))


asyncio.run(main())
