// Warrant — the reference instrument.
//
// An ESP32 advertising a GATT characteristic, paired to the Android client, filling a
// `measurement` field in a live form.
//
// WHAT IT MEASURES IS IRRELEVANT. This exists to prove the path end to end and to make the
// driver abstraction concrete: any device speaking this contract works, whether it is a
// commercial torque wrench, a gauge, a reader, or something built for four dollars. Attach
// whatever sensor the job needs — nothing above the driver changes.
//
// We do not claim this measures anything useful (docs/architecture.md §12). It demonstrates
// that a number can reach a sealed record without passing through a human, which is the only
// property that makes a value `measured` rather than typed.
//
// ---------------------------------------------------------------------------------------
// The contract, which must match ink.warrant.instrument.Esp32ReferenceDriver exactly:
//
//   service        6e1a0001-b5a3-f393-e0a9-e50e24dcca9e
//   characteristic 6e1a0002-b5a3-f393-e0a9-e50e24dcca9e   notify + read   value
//   attestation    6e1a0003-b5a3-f393-e0a9-e50e24dcca9e   notify + read   signed frame
//   payload        4 bytes, little-endian IEEE-754 float
//   frame          40 bytes: counter u32 LE | value 4 bytes | HMAC-SHA256 32 bytes
//   device name    "Warrant Ref 01"   (the driver also matches the "Warrant" name prefix)
//
// Change these in one place and you must change them in the other, or use the client's
// generic-GATT fallback, which reads the device but marks the tool id `unvetted-`.
//
// ---------------------------------------------------------------------------------------
// WHY THIS DEVICE SIGNS.
//
// It did not, and that was the weakest joint in the whole product. The characteristic above is
// an unauthenticated broadcast on a fixed UUID: anything can advertise this name and emit any
// float. The PHONE held the API credential and vouched for the number, so `measured` — the
// class the sealed record's headline honesty claim rests on — actually meant "an app holding a
// shared password said so". That is a strictly weaker claim than "an instrument produced this",
// and it was being recorded as the stronger one.
//
// So the device now keeps a secret the handset never sees, and signs what it measured:
//
//     HMAC-SHA256(KEY, "warrant-reading-v1|" TOOL_ID "|" counter "|" <the 4 raw bytes>)
//
// The server (web/src/server/instruments.ts) decodes the value from the SIGNED BYTES rather
// than believing the number the phone reported, so the relay cannot carry one figure and report
// another. An unsigned reading is still accepted and still reaches the form — it simply cannot
// make anything `measured`.
//
// The counter is persisted in NVS and strictly increases, because BLE is a broadcast: without
// it, a frame overheard once could be replayed onto a different job for as long as the device
// lived. It survives reboot on purpose — a counter that restarted at zero would have every
// frame refused as stale until it climbed back past the highest the server had already seen.
//
// SET WARRANT_TOOL_ID AND WARRANT_TOOL_KEY BELOW BEFORE FLASHING. The key must match the
// secret registered for this tool in that tenant's WARRANT_INSTRUMENT_KEYS entry
// (`tenant|toolId|secret`). A board flashed with the defaults signs frames nothing will accept,
// which is the correct failure: it reports UNATTESTED rather than being believed.
// ---------------------------------------------------------------------------------------
//
// Board: any ESP32 dev module.  Arduino IDE → Tools → Board → "ESP32 Dev Module".
// Flash: Sketch → Upload. No libraries beyond the ESP32 core are required.

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <mbedtls/md.h>
#include <string.h>

static const char* SERVICE_UUID        = "6e1a0001-b5a3-f393-e0a9-e50e24dcca9e";
static const char* CHARACTERISTIC_UUID = "6e1a0002-b5a3-f393-e0a9-e50e24dcca9e";
static const char* ATTESTATION_UUID    = "6e1a0003-b5a3-f393-e0a9-e50e24dcca9e";
static const char* DEVICE_NAME         = "Warrant Ref 01";

// ---- IDENTITY. Change both before flashing; see the note at the top of this file. ----------
//
// TOOL_ID is what the record will name. KEY is the secret this board proves it holds, and it
// must never appear in the Android app — the whole point is that the handset cannot forge a
// frame it is merely carrying.
static const char* TOOL_ID  = "warrant-ref-01";
static const char* TOOL_KEY = "change-me-before-flashing";

//: The domain separator, matching READING_SIGNATURE_V1 in web/src/server/instruments.ts.
//: Signed material without one can be replayed into any other protocol sharing the key.
static const char* SIGNATURE_V1 = "warrant-reading-v1";

// The demo procedure torques a caliper bolt to 6-9 Nm, so the reference instrument reports
// a value in that band. Swap this function for a real sensor read and nothing else changes —
// that substitution is the entire point of the exercise.
static float readSensor() {
  // A slow sweep across the acceptance band and slightly outside it, so the client can be seen
  // both passing and failing the `within(6, 9, "Nm")` rule without anybody faking a number.
  // 7.5 ± 2.0 sweeps 5.5 → 9.5, which clears the band at both ends.
  static float t = 0.0f;
  t += 0.05f;
  return 7.5f + 2.0f * sinf(t);
}

BLECharacteristic* characteristic = nullptr;
BLECharacteristic* attestation = nullptr;
bool clientConnected = false;

//: Strictly increasing, and persisted. See the replay note at the top of this file.
Preferences prefs;
uint32_t counter = 0;

/**
 * Sign one measurement as this device.
 *
 * The message is the raw value BYTES rather than a formatted number, deliberately: a decimal
 * string would make the signature depend on how two languages happen to render a float, and a
 * verification that fails on a rounding difference is a verification somebody switches off.
 */
static void signFrame(uint32_t n, const uint8_t* raw, uint8_t out[32]) {
  char prefix[128];
  const int prefixLen = snprintf(prefix, sizeof(prefix), "%s|%s|%u|",
                                 SIGNATURE_V1, TOOL_ID, (unsigned)n);

  const mbedtls_md_info_t* md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, md, 1 /* HMAC */);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)TOOL_KEY, strlen(TOOL_KEY));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)prefix, prefixLen);
  mbedtls_md_hmac_update(&ctx, raw, 4);
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
}

/**
 * Publish the signed frame beside the plain value.
 *
 * 40 bytes: counter u32 LE, the 4 value bytes, then the 32-byte HMAC. The plain characteristic
 * keeps notifying unchanged, so a client that does not know about attestation still reads a
 * number — it simply gets one that cannot be called `measured`.
 */
static void publishAttested(const uint8_t* raw) {
  counter += 1;
  // Persisted BEFORE it is handed out. A frame published and then lost to a reset would let the
  // same counter be issued twice, which is the one thing the counter exists to prevent.
  prefs.putUInt("counter", counter);

  uint8_t frame[40];
  frame[0] = (uint8_t)(counter & 0xff);
  frame[1] = (uint8_t)((counter >> 8) & 0xff);
  frame[2] = (uint8_t)((counter >> 16) & 0xff);
  frame[3] = (uint8_t)((counter >> 24) & 0xff);
  memcpy(frame + 4, raw, 4);
  signFrame(counter, raw, frame + 8);

  attestation->setValue(frame, sizeof(frame));
  attestation->notify();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    clientConnected = true;
    Serial.println("client connected");
  }
  void onDisconnect(BLEServer* server) override {
    clientConnected = false;
    Serial.println("client disconnected; advertising again");
    // Without this the device is invisible after the first disconnect, which reads as
    // "the hardware died" and costs an hour every time.
    BLEDevice::startAdvertising();
  }
};

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("Warrant reference instrument starting");

  // The counter survives a reboot on purpose: restarting at zero would have every frame
  // refused as stale until it climbed back past the highest the server had already recorded.
  prefs.begin("warrant", false);
  counter = prefs.getUInt("counter", 0);
  Serial.print("resuming at counter ");
  Serial.println(counter);

  if (strcmp(TOOL_KEY, "change-me-before-flashing") == 0) {
    // Said plainly rather than left to be discovered from a server log. A board with the
    // default key signs frames nothing will accept — which is the correct failure, but a
    // silent one costs an afternoon.
    Serial.println("WARNING: TOOL_KEY is the default. Readings will record as UNATTESTED.");
  }

  BLEDevice::init(DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);

  characteristic = service->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);

  // The CCCD. Without it the client can subscribe and will simply never be notified.
  characteristic->addDescriptor(new BLE2902());

  attestation = service->createCharacteristic(
      ATTESTATION_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  attestation->addDescriptor(new BLE2902());

  float initial = readSensor();
  characteristic->setValue((uint8_t*)&initial, sizeof(initial));
  publishAttested((const uint8_t*)&initial);

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.print("advertising as ");
  Serial.println(DEVICE_NAME);
}

void loop() {
  if (clientConnected && characteristic != nullptr) {
    float value = readSensor();
    // Little-endian on the ESP32, which is what the driver's decode() expects. If you port
    // this to a big-endian part, byte-swap here rather than in the client — the wire format
    // is the contract.
    characteristic->setValue((uint8_t*)&value, sizeof(value));
    characteristic->notify();

    // The same number, signed as this device. Published second so a client subscribed to both
    // never sees an attestation for a value it has not been given yet.
    publishAttested((const uint8_t*)&value);

    Serial.print("notified ");
    Serial.println(value);
  }
  delay(500);
}
