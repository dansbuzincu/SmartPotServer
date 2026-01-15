#!/usr/bin/env python3

import subprocess
import re
import sys
import serial.tools.list_ports

ports = list(serial.tools.list_ports.comports())
if not ports:
    print("❌ No serial (COM) ports detected.")
    print("Check: USB data cable, drivers (CP210x/CH340), and Device Manager → Ports (COM & LPT).")
    sys.exit(1)


def main():
    try:
        result = subprocess.run(
            [sys.executable, "-m", "esptool", "read_mac"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5
        )
    except FileNotFoundError:
        print("❌ esptool.py not found. Install it with: pip install esptool")
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("❌ Timeout while trying to communicate with ESP32")
        sys.exit(1)

    if result.returncode != 0:
        print("❌ Failed to run esptool.py")
        print(result.stderr.strip())
        sys.exit(1)

    match = re.search(r"MAC:\s*([0-9a-fA-F:]{17})", result.stdout)
    if not match:
        print("❌ No ESP32 detected or MAC not found.")
        print("Make sure the device is connected and not in use.")
        sys.exit(1)

    mac = match.group(1).replace(":", "").upper()
    unique_id = f"SPT-{mac}"

    print(unique_id)


if __name__ == "__main__":
    main()
