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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

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

        /** Characteristic Presentation Format — where a device states its own encoding. */
        private val CPF: UUID = UUID.fromString("00002904-0000-1000-8000-00805f9b34fb")

        /**
         * How long to wait for a presentation-format descriptor before giving up on it.
         *
         * A device may accept the read and simply never answer. Without a deadline the
         * connection sits in Connecting for ever, having emitted neither a reading nor a
         * failure — the one state a technician cannot act on.
         */
        private const val DESCRIPTOR_TIMEOUT_MS = 2_000L

        /**
         * A beat between stopping the scan and opening a connection.
         *
         * Connecting while the radio is still scanning is the single most common cause of
         * status 133 on Android, and stopping the scan is not instantaneous.
         */
        private const val SCAN_SETTLE_MS = 300L

        /** The drivers that ship in the box, in match order. */
        val DRIVERS: List<Driver> = listOf(Esp32ReferenceDriver, EnvironmentalSensingDriver)
    }

    data class Found(
        val address: String,
        val name: String?,
        val rssi: Int,
        /** Null when nothing shipped matches — [GenericGattDriver] will be tried on connect. */
        val driver: Driver?,
        val connectable: Boolean = false,
    ) {
        /**
         * The same device, seen again.
         *
         * Later sightings ADD to what is known rather than replacing it. The name arrives in
         * the scan response rather than the advertisement, so the packet that identifies a
         * device is routinely not the first one seen — and dropping it is why almost everything
         * showed as "(unnamed)".
         */
        fun merge(newer: Found): Found = copy(
            name = newer.name ?: name,
            rssi = newer.rssi,
            driver = newer.driver ?: driver,
            // Sticky. Only the connectable advertisement carries the flag; the scan response
            // that follows reports false on several stacks, and taking the newest value would
            // make a pairable device look like a beacon.
            connectable = connectable || newer.connectable,
        )
    }

    /** The scan in progress, so a connection can stop it. See [SCAN_SETTLE_MS]. */
    private var activeScan: ScanCallback? = null

    @SuppressLint("MissingPermission")
    private fun stopScanning() {
        val callback = activeScan ?: return
        activeScan = null
        runCatching { adapter?.bluetoothLeScanner?.stopScan(callback) }
    }

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

        val seen = mutableMapOf<String, Found>()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val device = result.device ?: return

                val advertised = result.scanRecord?.serviceUuids?.map { it.uuid }.orEmpty()
                val name = result.scanRecord?.deviceName ?: runCatching { device.name }.getOrNull()

                val driver = DRIVERS.firstOrNull { d ->
                    d.matches.serviceUuids.any { it in advertised } ||
                        d.matches.namePrefixes.any { p -> name?.startsWith(p, true) == true }
                }
                val incoming = Found(
                    address = device.address,
                    name = name,
                    rssi = result.rssi,
                    driver = driver,
                    // API 26, which is our floor. Beacons, Continuity adverts and Fast Pair
                    // broadcast constantly and refuse every connection; listing them as though
                    // they were pairable is most of "I can't connect to anything".
                    connectable = result.isConnectable,
                )

                // Every sighting, not just the first. Returning early here is what discarded
                // the scan response that carries the name.
                val previous = seen[device.address]
                val merged = previous?.merge(incoming) ?: incoming
                if (merged == previous) return
                seen[device.address] = merged
                // Rate-limited by the equality check above: one line per device, plus one each
                // time a later advertisement actually tells us something new.
                Log.i(
                    TAG,
                    "scan  ${device.address} rssi=${result.rssi} " +
                        "connectable=${result.isConnectable} name=${merged.name ?: "-"} " +
                        "uuids=${advertised.size} bytes=${result.scanRecord?.bytes?.size ?: 0}",
                )
                trySend(merged)
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
        activeScan = callback
        runCatching { scanner.startScan(null, settings, callback) }.onFailure { close(it) }

        awaitClose {
            activeScan = null
            runCatching { scanner.stopScan(callback) }
        }
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

        // Before anything else. A scan still running is why so many attempts came back 133,
        // and the UI cancelling its collector does not stop the radio synchronously.
        stopScanning()
        delay(SCAN_SETTLE_MS)

        var gatt: BluetoothGatt? = null
        var driver: Driver? = preferred
        // Atomic because the descriptor callback and its timeout race, and whichever arrives
        // first must be the only one that settles on a driver.
        val pending = AtomicReference<Candidate?>(null)
        val producer = this

        val callback = object : BluetoothGattCallback() {

            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                // A connection that FAILED is not a connection that ENDED. This argument was
                // being discarded, so a device that refused outright reached the technician as
                // an ordinary disconnect and the screen simply went back to unpaired.
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    Log.w(TAG, "connection failed, status=$status")
                    trySend(InstrumentEvent.Failed(connectionFailureMessage(status)))
                    close(); return
                }
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
                val shipped = (listOfNotNull(preferred) + DRIVERS)
                    .firstOrNull { it.characteristicFor(services) != null }
                if (shipped != null) { adopt(g, shipped); return }

                // Nothing shipped claimed this device. RANK what is left rather than taking the
                // first thing that answers: the first readable characteristic is very often the
                // battery level, which decodes to a plausible number and is not a reading.
                // See GattTree.readingCandidates and design §2 defect 2.
                val tree = gattTree(g)
                // Why this one and not the others. Without it, an unfamiliar device at a bench
                // gives you a chosen characteristic and no way to tell whether it was the right
                // one — see GattTree.explain.
                tree.explain().forEach { Log.i(TAG, "gatt  $it") }

                val candidate = tree.readingCandidates().firstOrNull()
                if (candidate == null) {
                    trySend(
                        InstrumentEvent.Failed(
                            "connected, but the device exposes nothing that could carry a " +
                                "reading. This is a real outcome, not a zero reading.",
                        ),
                    )
                    close(); return
                }
                pending.set(candidate)

                // Before assuming an encoding, ask whether the device declares one. Where the
                // 0x2904 descriptor exists this stops being a guess entirely.
                val cpf = g.getService(candidate.service.uuid)
                    ?.getCharacteristic(candidate.characteristic.uuid)
                    ?.getDescriptor(CPF)
                if (cpf == null || !g.readDescriptor(cpf)) {
                    Log.i(TAG, "no presentation format to read; decoding will be a guess")
                    declared(g, null)
                    return
                }
                producer.launch {
                    delay(DESCRIPTOR_TIMEOUT_MS)
                    if (pending.get() != null) {
                        Log.w(TAG, "presentation format was requested but never arrived")
                        declared(g, null)
                    }
                }
            }

            override fun onDescriptorRead(
                g: BluetoothGatt,
                descriptor: BluetoothGattDescriptor,
                status: Int,
                value: ByteArray,
            ) {
                if (descriptor.uuid == CPF) {
                    declared(g, if (status == BluetoothGatt.GATT_SUCCESS) value else null)
                }
            }

            @Deprecated("Pre-33 path", ReplaceWith(""))
            @Suppress("DEPRECATION")
            override fun onDescriptorRead(
                g: BluetoothGatt,
                descriptor: BluetoothGattDescriptor,
                status: Int,
            ) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU &&
                    descriptor.uuid == CPF
                ) {
                    declared(g, if (status == BluetoothGatt.GATT_SUCCESS) descriptor.value else null)
                }
            }

            /**
             * The presentation format came back, or did not. Either way a driver is chosen here
             * and the connection proceeds — a device that will not surrender its descriptor is
             * no worse off than it was before we asked.
             */
            private fun declared(g: BluetoothGatt, raw: ByteArray?) {
                val c = pending.getAndSet(null) ?: return
                val fromDevice = raw
                    ?.let(PresentationFormat::parse)
                    ?.let {
                        DeclaredFormatDriver.from(
                            service = c.service.uuid,
                            characteristic = c.characteristic.uuid,
                            format = it,
                        )
                    }
                if (fromDevice == null && raw != null) {
                    Log.i(TAG, "device declared a format we could not turn into a united driver")
                }
                adopt(g, fromDevice ?: guessFor(c))
            }

            private fun guessFor(c: Candidate): Driver =
                GenericGattDriver(CharacteristicRef(c.service.uuid, c.characteristic.uuid))

            /** Settle on a driver, announce it, and start the reads. */
            private fun adopt(g: BluetoothGatt, chosen: Driver) {
                driver = chosen
                Log.i(TAG, "driver ${chosen.id} (${chosen.label}) unit='${chosen.produces.unit}'")

                val ref = chosen.characteristicFor(g.services.map { it.uuid })
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

    /**
     * What the device exposes, as a structure that can be reasoned about.
     *
     * Descriptor VALUES are not populated by service discovery — each needs its own read — so
     * the tree built here carries structure only. That is enough to rank candidates and exclude
     * the decoys, which is the part that fixes a live defect; the winner's `0x2904` is read
     * separately in the callback above.
     */
    @SuppressLint("MissingPermission")
    private fun gattTree(g: BluetoothGatt): GattTree = GattTree(
        g.services.map { s ->
            GattService(
                uuid = s.uuid,
                characteristics = s.characteristics.map { c ->
                    GattCharacteristic(
                        uuid = c.uuid,
                        properties = propertiesOf(c),
                        userDescription = null,
                        presentationFormat = null,
                    )
                },
            )
        },
    )

    private fun propertiesOf(c: BluetoothGattCharacteristic): Set<GattProperty> = buildSet {
        val p = c.properties
        if (p and BluetoothGattCharacteristic.PROPERTY_READ != 0) add(GattProperty.READ)
        if (p and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) add(GattProperty.WRITE)
        if (p and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) {
            add(GattProperty.WRITE_NO_RESPONSE)
        }
        if (p and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) add(GattProperty.NOTIFY)
        if (p and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0) add(GattProperty.INDICATE)
    }

    @SuppressLint("MissingPermission")
    private fun toolIdFor(device: BluetoothDevice, driver: Driver): String {
        // The device address is the identity. Without it the value is typed, not measured —
        // so it is not cosmetic and it is not optional.
        val short = device.address.replace(":", "").takeLast(6).uppercase()
        // Three standings, distinguishable on the record: vetted (we wrote the driver),
        // declared (the device stated its encoding), guessed (nobody knows).
        return when (driver) {
            is GenericGattDriver -> "unvetted-$short"
            is DeclaredFormatDriver -> "${DeclaredFormatDriver.TOOL_ID_PREFIX}$short"
            else -> short
        }
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
