package ink.warrant.instrument

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.util.UUID

/**
 * The only place the instrument is reachable.
 *
 * BLE pairing and reads live on the client because there is nowhere else they can live — a
 * cloud service cannot talk to a wrench in a workshop. This is one of the four things
 * `architecture.md` §6 gives the client, and the one that a browser can never have, which is
 * why the *measured* class is out of reach from a web page and reachable from here.
 */
class InstrumentClient(private val context: Context) {

    companion object {
        private const val TAG = "InstrumentClient"

        /** Client Characteristic Configuration — how you subscribe to notifications. */
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        /** Services every device exposes; never what we want to read. */
        private val GENERIC = setOf(sig(0x1800), sig(0x1801), sig(0x180A))

        /** The drivers that ship in the box, in match order. */
        val DRIVERS: List<Driver> = listOf(Esp32ReferenceDriver, EnvironmentalSensingDriver)
    }

    data class Found(
        val address: String,
        val name: String?,
        val rssi: Int,
        /** Null when nothing shipped matches — [GenericGattDriver] will be tried on connect. */
        val driver: Driver?,
    )

    private val adapter: BluetoothAdapter? by lazy {
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    }

    /** Whether the platform will let us scan at all right now. */
    fun readiness(): Readiness {
        val a = adapter ?: return Readiness.NoHardware
        if (!a.isEnabled) return Readiness.BluetoothOff
        if (missingPermissions().isNotEmpty()) return Readiness.NeedsPermission(missingPermissions())
        return Readiness.Ready
    }

    sealed interface Readiness {
        data object Ready : Readiness
        data object NoHardware : Readiness
        data object BluetoothOff : Readiness
        data class NeedsPermission(val permissions: List<String>) : Readiness
    }

    /**
     * Android 12 split BLE out of the location permission. Below 31 a scan is still a location
     * permission whether or not anybody wanted a location.
     */
    fun missingPermissions(): List<String> {
        val needed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        return needed.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Scans for anything a shipped driver recognises, plus everything else.
     *
     * Unfiltered on purpose: a technician holding an unfamiliar tool should SEE it in the list
     * and be told no driver claims it, rather than watch it silently not appear. That listing
     * is also the input Wright works from.
     */
    @SuppressLint("MissingPermission")
    fun scan(): Flow<Found> = callbackFlow {
        val scanner = adapter?.bluetoothLeScanner
        if (scanner == null) {
            close(IllegalStateException("no BLE scanner — Bluetooth is off or absent"))
            return@callbackFlow
        }

        val seen = mutableSetOf<String>()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device ?: return
                if (!seen.add(device.address)) return

                val advertised = result.scanRecord?.serviceUuids?.map { it.uuid }.orEmpty()
                val name = result.scanRecord?.deviceName ?: runCatching { device.name }.getOrNull()

                val driver = DRIVERS.firstOrNull { d ->
                    d.matches.serviceUuids.any { it in advertised } ||
                        d.matches.namePrefixes.any { p -> name?.startsWith(p, true) == true }
                }
                trySend(Found(device.address, name, result.rssi, driver))
            }

            override fun onScanFailed(errorCode: Int) {
                close(IllegalStateException("BLE scan failed, code $errorCode"))
            }
        }

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        // Null filters = report everything. A hardware filter would be cheaper, but it would
        // also hide the unfamiliar device the technician is holding, and "it never appeared"
        // is the least debuggable failure BLE has.
        runCatching { scanner.startScan(null, settings, callback) }.onFailure { close(it) }

        awaitClose { runCatching { scanner.stopScan(callback) } }
    }

    /**
     * Connects, discovers, picks a driver, and streams readings.
     *
     * The flow terminates when the caller stops collecting; the GATT connection is closed in
     * [awaitClose], which matters because Android leaks a GATT client per un-closed connection
     * and there are only a handful available per process.
     */
    @SuppressLint("MissingPermission")
    fun connect(address: String, preferred: Driver? = null): Flow<InstrumentEvent> = callbackFlow {
        val device: BluetoothDevice = try {
            adapter?.getRemoteDevice(address)
                ?: run { close(IllegalStateException("Bluetooth unavailable")); return@callbackFlow }
        } catch (e: IllegalArgumentException) {
            close(e); return@callbackFlow
        }

        trySend(InstrumentEvent.Connecting)
        var gatt: BluetoothGatt? = null
        var driver: Driver? = preferred

        val callback = object : BluetoothGattCallback() {

            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> g.discoverServices()
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        trySend(InstrumentEvent.Disconnected)
                        close()
                    }
                }
            }

            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    trySend(InstrumentEvent.Failed("service discovery failed ($status)"))
                    close(); return
                }

                val services = g.services.map { it.uuid }
                val chosen = (listOfNotNull(preferred) + DRIVERS)
                    .firstOrNull { it.characteristicFor(services) != null }
                    ?: fallbackDriver(g)

                if (chosen == null) {
                    trySend(
                        InstrumentEvent.Failed(
                            "connected, but the device exposes nothing readable. This is a real " +
                                "outcome, not a zero reading.",
                        ),
                    )
                    close(); return
                }
                driver = chosen

                val ref = chosen.characteristicFor(services)
                val characteristic = ref?.let { g.getService(it.service)?.getCharacteristic(it.characteristic) }
                if (characteristic == null) {
                    trySend(InstrumentEvent.Failed("${chosen.label} matched but its characteristic is absent"))
                    close(); return
                }

                trySend(InstrumentEvent.Connected(toolId = toolIdFor(device, chosen), driver = chosen))

                if (characteristic.supportsNotify()) {
                    g.setCharacteristicNotification(characteristic, true)
                    characteristic.getDescriptor(CCCD)?.let { d -> enableNotifications(g, d) }
                } else if (characteristic.supportsRead()) {
                    g.readCharacteristic(characteristic)
                } else {
                    trySend(InstrumentEvent.Failed("characteristic is neither readable nor notifiable"))
                    close()
                }
            }

            // API 33+ hands the bytes to the callback; below, they are on the characteristic.
            override fun onCharacteristicChanged(
                g: BluetoothGatt,
                c: BluetoothGattCharacteristic,
                value: ByteArray,
            ) = emit(value)

            @Deprecated("Pre-33 path", ReplaceWith(""))
            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) emit(c.value ?: return)
            }

            override fun onCharacteristicRead(
                g: BluetoothGatt,
                c: BluetoothGattCharacteristic,
                value: ByteArray,
                status: Int,
            ) {
                if (status == BluetoothGatt.GATT_SUCCESS) emit(value)
            }

            @Deprecated("Pre-33 path", ReplaceWith(""))
            @Suppress("DEPRECATION")
            override fun onCharacteristicRead(
                g: BluetoothGatt,
                c: BluetoothGattCharacteristic,
                status: Int,
            ) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU &&
                    status == BluetoothGatt.GATT_SUCCESS
                ) {
                    emit(c.value ?: return)
                }
            }

            private fun emit(raw: ByteArray) {
                val d = driver ?: return
                val value = d.decode(raw)
                if (value == null) {
                    // Not a reading. A keep-alive or a truncated frame. Saying nothing is
                    // correct; inventing a number here is the worst thing this code could do.
                    Log.d(TAG, "ignored ${raw.size} bytes that did not decode")
                    return
                }
                trySend(
                    InstrumentEvent.Value(
                        value = value,
                        unit = d.produces.unit,
                        toolId = toolIdFor(device, d),
                        plausible = d.produces.plausible(value),
                        driverId = d.id,
                    ),
                )
            }
        }

        gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)

        awaitClose {
            runCatching {
                gatt?.disconnect()
                gatt?.close()
            }
        }
    }

    /** Nothing shipped claimed this device. Take the first thing we can read, and say so. */
    @SuppressLint("MissingPermission")
    private fun fallbackDriver(g: BluetoothGatt): Driver? {
        val candidate = g.services
            .filter { it.uuid !in GENERIC }
            .flatMap { s -> s.characteristics.map { s.uuid to it } }
            .firstOrNull { (_, c) -> c.supportsNotify() || c.supportsRead() }
            ?: return null
        return GenericGattDriver(CharacteristicRef(candidate.first, candidate.second.uuid))
    }

    @SuppressLint("MissingPermission")
    private fun toolIdFor(device: BluetoothDevice, driver: Driver): String {
        // The device address is the identity. Without it the value is typed, not measured —
        // so it is not cosmetic and it is not optional.
        val short = device.address.replace(":", "").takeLast(6).uppercase()
        return if (driver is GenericGattDriver) "unvetted-$short" else short
    }

    @SuppressLint("MissingPermission")
    private fun enableNotifications(g: BluetoothGatt, descriptor: BluetoothGattDescriptor) {
        val on = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeDescriptor(descriptor, on)
        } else {
            @Suppress("DEPRECATION")
            run {
                descriptor.value = on
                g.writeDescriptor(descriptor)
            }
        }
    }
}

sealed interface InstrumentEvent {
    data object Connecting : InstrumentEvent
    data class Connected(val toolId: String, val driver: Driver) : InstrumentEvent

    /** A number that did not pass through a human. */
    data class Value(
        val value: Double,
        val unit: String,
        val toolId: String,
        /**
         * Inside the driver's declared range. Plausibility is the standard here, deliberately:
         * it will not catch a wrong scale factor that yields a sensible-looking number.
         */
        val plausible: Boolean,
        val driverId: String,
    ) : InstrumentEvent

    data class Failed(val reason: String) : InstrumentEvent
    data object Disconnected : InstrumentEvent
}
