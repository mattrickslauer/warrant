#!/usr/bin/env python3
"""Download the NHTSA vPIC vehicle catalogue into seed/vpic/.

    python3 scripts/fetch_seed_vpic.py

vPIC is the US Department of Transportation's Vehicle Product Information
Catalog. It is a work of the US federal government, needs no authentication and
no key, and covers every vehicle sold in the US from model year 1981 forward.

It seeds the *breadth* of type space -- twelve thousand manufacturers and the
make/model/year spine underneath them -- where Open Source Ecology seeds the
depth. Nothing here goes below ISO 14224 level 6 (the equipment unit); vPIC
knows what a machine is, not what it is made of.

Motorcycles are pulled in detail because the demonstration workshop services
them.

Writes:
    seed/vpic/makes.json                 every manufacturer
    seed/vpic/vehicle_types.json         the type list
    seed/vpic/makes_by_type.json         manufacturers per vehicle type
    seed/vpic/motorcycle_models.json     models by make and year
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://vpic.nhtsa.dot.gov/api/vehicles"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "seed", "vpic")
UA = "warrant-seed/1.0 (hackathon research; contact via repo)"
PAUSE = 0.2

# The vehicle types vPIC classifies makes under.
TYPES = ["Passenger Car", "Truck", "Multipurpose Passenger Vehicle (MPV)",
         "Motorcycle", "Bus", "Trailer", "Incomplete Vehicle",
         "Low Speed Vehicle (LSV)", "Off Road Vehicle"]

# Marques a working motorcycle shop actually sees.
MOTO_MAKES = ["HONDA", "YAMAHA", "KAWASAKI", "SUZUKI", "DUCATI", "BMW",
              "TRIUMPH", "HARLEY-DAVIDSON", "KTM", "APRILIA",
              "ROYAL ENFIELD", "MOTO GUZZI", "HUSQVARNA", "INDIAN"]
YEARS = range(2018, 2027)


def get(path):
    url = f"{API}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == 3:
                raise
            print(f"    retry {attempt + 1} after {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def write(name, obj):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True)


def main():
    print("makes ...")
    makes = get("GetAllMakes?format=json")
    write("makes.json", makes)
    print(f"  {makes['Count']} manufacturers")

    write("vehicle_types.json", TYPES)

    print("makes by vehicle type ...")
    by_type = {}
    for t in TYPES:
        enc = urllib.parse.quote(t)
        try:
            r = get(f"GetMakesForVehicleType/{enc}?format=json")
            by_type[t] = r.get("Results", [])
            print(f"  {t}: {len(by_type[t])}")
        except Exception as e:
            print(f"  ! {t}: {e}", file=sys.stderr)
            by_type[t] = []
        time.sleep(PAUSE)
    write("makes_by_type.json", by_type)

    print("motorcycle models ...")
    models = {}
    for make in MOTO_MAKES:
        models[make] = {}
        for year in YEARS:
            enc = urllib.parse.quote(make)
            try:
                r = get(f"GetModelsForMakeYear/make/{enc}/modelyear/{year}?format=json")
                got = r.get("Results", [])
                if got:
                    models[make][str(year)] = got
            except Exception as e:
                print(f"  ! {make} {year}: {e}", file=sys.stderr)
            time.sleep(PAUSE)
        n = sum(len(v) for v in models[make].values())
        print(f"  {make}: {n} model-years")
    write("motorcycle_models.json", models)

    print("done: seed/vpic/")


if __name__ == "__main__":
    main()
