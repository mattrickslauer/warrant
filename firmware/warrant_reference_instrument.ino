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
//   characteristic 6e1a0002-b5a3-f393-e0a9-e50e24dcca9e   notify + read
//   payload        4 bytes, little-endian IEEE-754 float
//   device name    "Warrant Ref 01"   (the driver also matches the "Warrant" name prefix)
//
// Change these in one place and you must change them in the other, or use the client's
// generic-GATT fallback, which reads the device but marks the tool id `unvetted-`.
// ---------------------------------------------------------------------------------------
//
// Board: any ESP32 dev module.  Arduino IDE → Tools → Board → "ESP32 Dev Module".
// Flash: Sketch → Upload. No libraries beyond the ESP32 core are required.

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

static const char* SERVICE_UUID        = "6e1a0001-b5a3-f393-e0a9-e50e24dcca9e";
static const char* CHARACTERISTIC_UUID = "6e1a0002-b5a3-f393-e0a9-e50e24dcca9e";
static const char* DEVICE_NAME         = "Warrant Ref 01";

// The demo procedure torques a caliper bolt to 26-30 Nm, so the reference instrument reports
// a value in that band. Swap this function for a real sensor read and nothing else changes —
// that substitution is the entire point of the exercise.
static float readSensor() {
  // A slow sweep across the acceptance band and slightly outside it, so the client can be seen
  // both passing and failing the `within(26, 30, "Nm")` rule without anybody faking a number.
  static float t = 0.0f;
  t += 0.05f;
  return 28.0f + 3.0f * sinf(t);
}

BLECharacteristic* characteristic = nullptr;
bool clientConnected = false;

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

  BLEDevice::init(DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);

  characteristic = service->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);

  // The CCCD. Without it the client can subscribe and will simply never be notified.
  characteristic->addDescriptor(new BLE2902());

  float initial = readSensor();
  characteristic->setValue((uint8_t*)&initial, sizeof(initial));

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

    Serial.print("notified ");
    Serial.println(value);
  }
  delay(500);
}
